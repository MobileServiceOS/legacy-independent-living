import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, verify } from "node:crypto";
import { b64u, encryptPayload, generateVapidKeys, sendWebPush, vapidJwt } from "../../src/lib/push/webpush.ts";
import { apnsJwt, apnsPayload, resetApnsJwtCache, sendApns } from "../../src/lib/push/apns.ts";

/** Browser side of RFC 8291: decrypt what the server sent. */
function uaDecrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  return plain.subarray(0, plain.length - 1).toString();
}

function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { priv: ecdh.getPrivateKey(), pub: ecdh.getPublicKey(), auth, sub: { p256dh: b64u.encode(ecdh.getPublicKey()), auth: b64u.encode(auth) } };
}

describe("Web Push encryption (RFC 8291)", () => {
  test("matches the RFC 8291 §5 test vector byte-for-byte", () => {
    const body = encryptPayload(Buffer.from("When I grow up, I want to be a watermelon"), {
      p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
    }, { salt: b64u.decode("DGv6ra1nlYgDCS1FRnbzlw"), serverKeys: { privateKey: b64u.decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw") } });
    assert.equal(
      b64u.encode(body),
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  test("round-trips through a simulated browser", () => {
    const b = browser();
    const msg = JSON.stringify({ title: "Rent due soon", body: "Your rent of $750.00 is due October 1, 2026.", url: "/home" });
    assert.equal(uaDecrypt(encryptPayload(Buffer.from(msg), b.sub), b.priv, b.pub, b.auth), msg);
  });

  test("rejects bad keys and oversize payloads", () => {
    const b = browser();
    assert.throws(() => encryptPayload(Buffer.from("x"), { p256dh: "AAAA", auth: b.sub.auth }), /p256dh/);
    assert.throws(() => encryptPayload(Buffer.from("x"), { p256dh: b.sub.p256dh, auth: "AAAA" }), /auth/);
    assert.throws(() => encryptPayload(Buffer.alloc(5000), b.sub), /too large/);
  });
});

describe("VAPID", () => {
  test("generated keys sign a JWT the push service can verify", () => {
    const keys = { ...generateVapidKeys(), subject: "mailto:office@example.test" };
    assert.equal(b64u.decode(keys.publicKey).length, 65);
    const jwt = vapidJwt("https://fcm.googleapis.com/fcm/send/abc", keys, 1_800_000_000);
    const [h, c, s] = jwt.split(".") as [string, string, string];
    assert.deepEqual(JSON.parse(b64u.decode(h).toString()), { typ: "JWT", alg: "ES256" });
    assert.deepEqual(JSON.parse(b64u.decode(c).toString()), { aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 43200, sub: "mailto:office@example.test" });
    const pub = b64u.decode(keys.publicKey);
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u.encode(pub.subarray(1, 33)), y: b64u.encode(pub.subarray(33)) }, format: "jwk" });
    assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, b64u.decode(s)));
  });

  test("sendWebPush posts encrypted body with VAPID + TTL headers; 410 means gone", async () => {
    const keys = { ...generateVapidKeys(), subject: "mailto:office@example.test" };
    const b = browser();
    let seen: { url: string; headers: Record<string, string>; body: Buffer } | null = null;
    const ok = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: Buffer.from(init.body as Uint8Array) };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const r = await sendWebPush({ endpoint: "https://push.example.test/sub/1", ...b.sub }, { title: "Hi" }, keys, { fetchImpl: ok, urgency: "high", topic: "rent-due!" });
    assert.deepEqual(r, { ok: true });
    assert.equal(seen!.headers["Content-Encoding"], "aes128gcm");
    assert.equal(seen!.headers.Urgency, "high");
    assert.equal(seen!.headers.Topic, "rent-due");
    assert.match(seen!.headers.Authorization!, new RegExp(`^vapid t=[^,]+, k=${keys.publicKey}$`));
    assert.equal(uaDecrypt(seen!.body, b.priv, b.pub, b.auth), JSON.stringify({ title: "Hi" }));

    const gone = (async () => new Response("expired", { status: 410 })) as unknown as typeof fetch;
    const r2 = await sendWebPush({ endpoint: "https://push.example.test/sub/1", ...b.sub }, { title: "Hi" }, keys, { fetchImpl: gone });
    assert.deepEqual(r2, { ok: false, gone: true, status: 410, reason: "expired" });
    const busy = (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch;
    const r3 = await sendWebPush({ endpoint: "https://push.example.test/sub/1", ...b.sub }, {}, keys, { fetchImpl: busy });
    assert.ok(!r3.ok && !r3.gone);
    const r4 = await sendWebPush({ endpoint: "http://insecure.test", ...b.sub }, {}, keys);
    assert.ok(!r4.ok && r4.gone);
  });
});

describe("APNs", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const cfg = { keyId: "ABC123DEFG", teamId: "TEAM123456", bundleId: "net.legacyindependentliving.app", privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(), production: false };
  const token = "a".repeat(64);

  test("provider JWT is ES256, kid/iss set, cached < 50 min", () => {
    resetApnsJwtCache();
    const t1 = apnsJwt(cfg, 1_800_000_000);
    const [h, c, s] = t1.split(".") as [string, string, string];
    assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", kid: "ABC123DEFG" });
    assert.deepEqual(JSON.parse(Buffer.from(c, "base64url").toString()), { iss: "TEAM123456", iat: 1_800_000_000 });
    assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
    assert.equal(apnsJwt(cfg, 1_800_000_000 + 60), t1);
    assert.notEqual(apnsJwt(cfg, 1_800_000_000 + 51 * 60), t1);
  });

  test("payload shape", () => {
    assert.deepEqual(apnsPayload({ title: "T", body: "B", link: "/pay", badge: 3 }), {
      aps: { alert: { title: "T", body: "B" }, sound: "default", badge: 3 },
      link: "/pay",
    });
  });

  test("sends to sandbox host with topic + push type; maps dead tokens", async () => {
    resetApnsJwtCache();
    let req: { host: string; path: string; headers: Record<string, string>; body: string } | null = null;
    const r = await sendApns(token, { title: "T", body: "B" }, cfg, async (x) => {
      req = x;
      return { status: 200, body: "" };
    });
    assert.deepEqual(r, { ok: true });
    assert.equal(req!.host, "https://api.sandbox.push.apple.com");
    assert.equal(req!.path, `/3/device/${token}`);
    assert.equal(req!.headers["apns-topic"], cfg.bundleId);
    assert.equal(req!.headers["apns-push-type"], "alert");
    assert.match(req!.headers.authorization!, /^bearer ey/);

    const dead = await sendApns(token, { title: "T", body: "B" }, cfg, async () => ({ status: 410, body: JSON.stringify({ reason: "Unregistered" }) }));
    assert.deepEqual(dead, { ok: false, gone: true, status: 410, reason: "Unregistered" });
    const bad = await sendApns(token, { title: "T", body: "B" }, cfg, async () => ({ status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) }));
    assert.ok(!bad.ok && bad.gone);
    const retry = await sendApns(token, { title: "T", body: "B" }, cfg, async () => ({ status: 503, body: JSON.stringify({ reason: "ServiceUnavailable" }) }));
    assert.ok(!retry.ok && !retry.gone);
    assert.ok(!(await sendApns("not-a-token", { title: "T", body: "B" }, cfg)).ok);
  });
});
