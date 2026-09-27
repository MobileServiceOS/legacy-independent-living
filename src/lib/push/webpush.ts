/**
 * Web Push sender (RFC 8030 transport, RFC 8291 aes128gcm encryption, RFC 8292 VAPID),
 * implemented with node:crypto only. Works for Chrome/Edge/Firefox and installed
 * iOS/iPadOS home-screen web apps (16.4+).
 */
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type KeyObject } from "node:crypto";

export const b64u = {
  encode: (buf: Uint8Array) => Buffer.from(buf).toString("base64url"),
  decode: (s: string) => Buffer.from(s.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"), "base64url"),
};

export interface VapidKeys {
  /** Uncompressed P-256 public key (65 bytes), base64url — also given to browsers as applicationServerKey. */
  publicKey: string;
  /** Private scalar d (32 bytes), base64url. */
  privateKey: string;
  /** Contact: "mailto:office@example.com" or an https URL. */
  subject: string;
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const d = ecdh.getPrivateKey();
  return { publicKey: b64u.encode(ecdh.getPublicKey()), privateKey: b64u.encode(Buffer.concat([Buffer.alloc(32 - d.length), d])) };
}

function vapidPrivateKeyObject(keys: VapidKeys): KeyObject {
  const pub = b64u.decode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be an uncompressed P-256 point");
  return createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u.encode(pub.subarray(1, 33)), y: b64u.encode(pub.subarray(33, 65)) },
    format: "jwk",
  });
}

/** ES256 JWT for VAPID (aud = push service origin). */
export function vapidJwt(endpoint: string, keys: VapidKeys, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64u.encode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: keys.subject })));
  const input = `${header}.${claims}`;
  const sig = sign("sha256", Buffer.from(input), { key: vapidPrivateKeyObject(keys), dsaEncoding: "ieee-p1363" });
  return `${input}.${b64u.encode(sig)}`;
}

const RECORD_SIZE = 4096;

/** RFC 8291 message encryption (single record). */
export function encryptPayload(
  payload: Uint8Array,
  subscriber: { p256dh: string; auth: string },
  opts: { salt?: Buffer; serverKeys?: { privateKey: Buffer } } = {},
): Buffer {
  const uaPublic = b64u.decode(subscriber.p256dh);
  const authSecret = b64u.decode(subscriber.auth);
  if (uaPublic.length !== 65) throw new Error("Invalid p256dh key");
  if (authSecret.length !== 16) throw new Error("Invalid auth secret");
  if (payload.length > RECORD_SIZE - 17 - 86) throw new Error("Push payload too large");

  const ecdh = createECDH("prime256v1");
  if (opts.serverKeys) ecdh.setPrivateKey(opts.serverKeys.privateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const salt = opts.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendResult = { ok: true } | { ok: false; gone: boolean; status: number; reason: string };

export async function sendWebPush(
  target: WebPushTarget,
  payload: object,
  keys: VapidKeys,
  opts: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high"; fetchImpl?: typeof fetch; topic?: string } = {},
): Promise<SendResult> {
  if (!/^https:\/\//.test(target.endpoint)) return { ok: false, gone: true, status: 0, reason: "invalid endpoint" };
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), target);
  const res = await (opts.fetchImpl ?? fetch)(target.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: String(opts.ttlSeconds ?? 4 * 24 * 3600),
      Urgency: opts.urgency ?? "normal",
      ...(opts.topic ? { Topic: opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
      Authorization: `vapid t=${vapidJwt(target.endpoint, keys)}, k=${keys.publicKey}`,
    },
    body,
  });
  if (res.status >= 200 && res.status < 300) return { ok: true };
  const reason = (await res.text().catch(() => "")).slice(0, 200) || res.statusText;
  // 404/410 = subscription expired or unsubscribed → stop sending to it.
  return { ok: false, gone: res.status === 404 || res.status === 410, status: res.status, reason };
}
