/**
 * Apple Push Notification service sender (token-based auth, HTTP/2), node built-ins only.
 * Used by the native iOS app (Capacitor) — device tokens come from the app's
 * PushNotifications.register() and are posted to /api/push/subscribe.
 */
import { connect, constants, type ClientHttp2Session } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";

export interface ApnsConfig {
  keyId: string; // 10-char Key ID of the .p8 key
  teamId: string; // Apple Developer Team ID
  bundleId: string; // apns-topic, e.g. net.legacyindependentliving.app
  privateKey: string; // contents of AuthKey_XXXX.p8 (PEM)
  production: boolean;
}

export const APNS_HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" } as const;

let cachedJwt: { token: string; iat: number; keyId: string } | null = null;

/** Provider token; Apple wants it refreshed between 20 and 60 minutes. */
export function apnsJwt(cfg: Pick<ApnsConfig, "keyId" | "teamId" | "privateKey">, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (cachedJwt && cachedJwt.keyId === cfg.keyId && nowSeconds - cachedJwt.iat < 50 * 60) return cachedJwt.token;
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: cfg.keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: cfg.teamId, iat: nowSeconds })).toString("base64url");
  const input = `${header}.${claims}`;
  const key = createPrivateKey(cfg.privateKey.replace(/\\n/g, "\n"));
  const sig = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const token = `${input}.${sig}`;
  cachedJwt = { token, iat: nowSeconds, keyId: cfg.keyId };
  return token;
}

export function resetApnsJwtCache() {
  cachedJwt = null;
}

export interface ApnsMessage {
  title: string;
  body: string;
  link?: string | null;
  badge?: number;
  threadId?: string;
}

export function apnsPayload(m: ApnsMessage): object {
  return {
    aps: {
      alert: { title: m.title, body: m.body },
      sound: "default",
      ...(typeof m.badge === "number" ? { badge: m.badge } : {}),
      ...(m.threadId ? { "thread-id": m.threadId } : {}),
    },
    link: m.link ?? "/",
  };
}

export type ApnsResult = { ok: true } | { ok: false; gone: boolean; status: number; reason: string };

/** Minimal transport interface so tests can substitute a fake. */
export type ApnsTransport = (req: { host: string; path: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; body: string }>;

let session: ClientHttp2Session | null = null;
let sessionHost = "";

export const http2Transport: ApnsTransport = ({ host, path, headers, body }) =>
  new Promise((resolve, reject) => {
    if (!session || session.closed || session.destroyed || sessionHost !== host) {
      session?.close();
      session = connect(host);
      sessionHost = host;
      session.on("error", () => {
        session = null;
      });
      session.unref();
    }
    const req = session.request({ [constants.HTTP2_HEADER_METHOD]: "POST", [constants.HTTP2_HEADER_PATH]: path, ...headers });
    let status = 0;
    let data = "";
    req.setEncoding("utf8");
    req.on("response", (h) => {
      status = Number(h[constants.HTTP2_HEADER_STATUS]);
    });
    req.on("data", (c: string) => (data += c));
    req.on("end", () => resolve({ status, body: data }));
    req.on("error", reject);
    req.setTimeout(10_000, () => req.close(constants.NGHTTP2_CANCEL));
    req.end(body);
  });

export async function sendApns(token: string, m: ApnsMessage, cfg: ApnsConfig, transport: ApnsTransport = http2Transport): Promise<ApnsResult> {
  if (!/^[0-9a-f]{64,200}$/.test(token)) return { ok: false, gone: true, status: 0, reason: "BadDeviceToken" };
  const res = await transport({
    host: cfg.production ? APNS_HOSTS.production : APNS_HOSTS.sandbox,
    path: `/3/device/${token}`,
    headers: {
      authorization: `bearer ${apnsJwt(cfg)}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(apnsPayload(m)),
  });
  if (res.status === 200) return { ok: true };
  let reason = "";
  try {
    reason = (JSON.parse(res.body) as { reason?: string }).reason ?? "";
  } catch {
    reason = res.body.slice(0, 100);
  }
  const gone = res.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic";
  return { ok: false, gone, status: res.status, reason: reason || `HTTP ${res.status}` };
}
