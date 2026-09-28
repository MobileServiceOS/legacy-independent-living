import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assertTransition,
  canTransition,
  isInFlight,
  makeReceiptNumber,
  validatePaymentAmount,
  validateRefundAmount,
} from "../../src/domain/payments.ts";
import { can, canAccessResidentRecord, homePathFor, ROLE_PERMISSIONS } from "../../src/domain/permissions.ts";
import { canMoveApplication } from "../../src/domain/applications.ts";
import { canAssignResident, occupancyMetrics } from "../../src/domain/rooms.ts";
import {
  generateToken,
  hashPassword,
  hashToken,
  validatePasswordStrength,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
} from "../../src/lib/security/crypto.ts";
import { clientIpFrom, createRateLimiter } from "../../src/lib/security/rate-limit.ts";
import { buildStripeSignatureHeader, verifyStripeSignature } from "../../src/lib/payments/stripe-signature.ts";
import { buildCheckoutParams, mapStripeEvent, StripePaymentProvider, toStripeForm } from "../../src/lib/payments/stripe.ts";
import { MockPaymentProvider } from "../../src/lib/payments/mock.ts";

describe("payment rules", () => {
  test("state machine", () => {
    assert.ok(canTransition("PENDING", "SUCCEEDED"));
    assert.ok(canTransition("PENDING", "PROCESSING"));
    assert.ok(canTransition("PROCESSING", "SUCCEEDED"));
    assert.ok(canTransition("SUCCEEDED", "REFUNDED"));
    assert.ok(!canTransition("FAILED", "SUCCEEDED"));
    assert.ok(!canTransition("REFUNDED", "SUCCEEDED"));
    assert.ok(!canTransition("SUCCEEDED", "FAILED"));
    assert.throws(() => assertTransition("CANCELED", "SUCCEEDED"));
    assert.ok(isInFlight("PROCESSING") && !isInFlight("SUCCEEDED"));
  });

  test("amount validation honors partial-payment policy", () => {
    const strict = { allowPartialPayments: false, minPartialPaymentCents: 0 };
    const loose = { allowPartialPayments: true, minPartialPaymentCents: 5000 };
    assert.equal(validatePaymentAmount(75000, 75000, strict), null);
    assert.match(validatePaymentAmount(30000, 75000, strict)!, /full balance/);
    assert.equal(validatePaymentAmount(30000, 75000, loose), null);
    assert.match(validatePaymentAmount(1000, 75000, loose)!, /at least \$50\.00/);
    assert.match(validatePaymentAmount(80000, 75000, loose)!, /most you can pay/);
    assert.match(validatePaymentAmount(100, 0, loose)!, /no balance/);
    assert.match(validatePaymentAmount(0, 75000, loose)!, /greater than/);
    assert.match(validatePaymentAmount(10.5, 75000, loose)!, /greater than/);
  });

  test("refunds are full-only", () => {
    assert.equal(validateRefundAmount(75000, 75000), null);
    assert.ok(validateRefundAmount(100, 75000));
  });

  test("receipt numbers", () => {
    assert.match(makeReceiptNumber("2026-10-01"), /^LIL-20261001-[2-9A-HJ-NP-Z]{6}$/);
  });
});

describe("authorization", () => {
  test("residents cannot reach admin permissions", () => {
    for (const p of ROLE_PERMISSIONS.ADMIN) assert.equal(can("RESIDENT", p), false, p);
    assert.ok(can("RESIDENT", "self:pay"));
    assert.ok(can("ADMIN", "payments:refund"));
    assert.ok(!can("ADMIN", "self:pay"));
    assert.ok(!can(null, "self:read"));
  });

  test("record-level ownership", () => {
    assert.ok(canAccessResidentRecord({ role: "RESIDENT", residentId: "r1" }, "r1"));
    assert.ok(!canAccessResidentRecord({ role: "RESIDENT", residentId: "r1" }, "r2"));
    assert.ok(!canAccessResidentRecord({ role: "RESIDENT", residentId: null }, "r1"));
    assert.ok(canAccessResidentRecord({ role: "ADMIN", residentId: null }, "r2"));
    assert.equal(homePathFor("RESIDENT"), "/home");
    assert.equal(homePathFor("ADMIN"), "/admin");
  });
});

describe("pipelines + rooms", () => {
  test("application transitions", () => {
    assert.ok(canMoveApplication("NEW", "UNDER_REVIEW"));
    assert.ok(canMoveApplication("APPROVED", "CONVERTED"));
    assert.ok(!canMoveApplication("NEW", "CONVERTED"));
    assert.ok(!canMoveApplication("CONVERTED", "DECLINED"));
  });

  test("room assignment + spec occupancy example (32/36 = 88.9%)", () => {
    assert.ok(canAssignResident("AVAILABLE") && canAssignResident("RESERVED"));
    assert.ok(!canAssignResident("OCCUPIED") && !canAssignResident("MAINTENANCE"));
    const rooms = [
      ...Array.from({ length: 32 }, () => ({ status: "OCCUPIED" as const })),
      ...Array.from({ length: 4 }, () => ({ status: "AVAILABLE" as const })),
    ];
    const m = occupancyMetrics(rooms);
    assert.deepEqual([m.totalRooms, m.occupied, m.available, m.occupancyRate], [36, 32, 4, 88.9]);
  });
});

describe("security primitives", () => {
  test("scrypt hash round-trip, wrong password, tampered hash", async () => {
    const hash = await hashPassword("Legacy2026!home");
    assert.match(hash, /^scrypt\$32768\$8\$1\$/);
    assert.ok(await verifyPassword("Legacy2026!home", hash));
    assert.ok(!(await verifyPassword("legacy2026!home", hash)));
    assert.ok(!(await verifyPassword("x", "not-a-hash")));
    assert.ok(!(await verifyPassword("x", null)));
    assert.ok(!(await verifyPassword("anything", DUMMY_PASSWORD_HASH)));
  });

  test("password strength", () => {
    assert.ok(validatePasswordStrength("short1"));
    assert.ok(validatePasswordStrength("onlyletterslong"));
    assert.equal(validatePasswordStrength("goodpassword1"), null);
  });

  test("tokens are random and stored hashed", () => {
    const a = generateToken();
    assert.notEqual(a, generateToken());
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hashToken(a), hashToken(a));
    assert.equal(hashToken(a).length, 64);
  });

  test("rate limiter window", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    assert.ok(rl.hit("k").allowed);
    assert.ok(rl.hit("k").allowed);
    const blocked = rl.hit("k");
    assert.ok(!blocked.allowed);
    assert.equal(blocked.retryAfterSeconds, 1);
    assert.ok(rl.hit("other").allowed);
    t = 1000;
    assert.ok(rl.hit("k").allowed);
  });

  test("rate limiter bounds memory", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0, maxKeys: 3 });
    for (let i = 0; i < 50; i++) rl.hit(`k${i}`);
    assert.ok(rl.hit("k49").allowed === false); // most recent key still tracked
  });
});

describe("stripe integration (offline)", () => {
  const secret = "whsec_test_123";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });

  test("signature verification", () => {
    const now = 1_790_000_000;
    const header = buildStripeSignatureHeader(payload, secret, now);
    assert.deepEqual(verifyStripeSignature(payload, header, secret, { nowSeconds: now }), { ok: true });
    assert.equal(verifyStripeSignature(payload + " ", header, secret, { nowSeconds: now }).ok, false);
    assert.equal(verifyStripeSignature(payload, header, "whsec_other", { nowSeconds: now }).ok, false);
    assert.equal(verifyStripeSignature(payload, header, secret, { nowSeconds: now + 301 }).ok, false);
    assert.equal(verifyStripeSignature(payload, null, secret).ok, false);
    assert.equal(verifyStripeSignature(payload, "t=1", secret, { nowSeconds: 1 }).ok, false);
  });

  test("event mapping (card vs ACH vs refund)", () => {
    const obj = (extra: object) => ({ metadata: { paymentId: "pay_1" }, payment_intent: "pi_1", ...extra });
    assert.equal(mapStripeEvent({ id: "e", type: "checkout.session.completed", data: { object: obj({ payment_status: "paid" }) } }).kind, "succeeded");
    assert.equal(mapStripeEvent({ id: "e", type: "checkout.session.completed", data: { object: obj({ payment_status: "unpaid" }) } }).kind, "processing");
    assert.equal(mapStripeEvent({ id: "e", type: "checkout.session.async_payment_succeeded", data: { object: obj({}) } }).kind, "succeeded");
    assert.equal(mapStripeEvent({ id: "e", type: "checkout.session.async_payment_failed", data: { object: obj({}) } }).kind, "failed");
    assert.equal(mapStripeEvent({ id: "e", type: "checkout.session.expired", data: { object: obj({}) } }).kind, "canceled");
    assert.equal(mapStripeEvent({ id: "e", type: "charge.refunded", data: { object: obj({ refunded: true }) } }).kind, "refunded");
    assert.equal(mapStripeEvent({ id: "e", type: "charge.refunded", data: { object: obj({ refunded: false }) } }).kind, "ignored");
    assert.equal(mapStripeEvent({ id: "e", type: "customer.created", data: { object: {} } }).kind, "ignored");
    const ev = mapStripeEvent({ id: "e", type: "checkout.session.completed", data: { object: { client_reference_id: "pay_9", payment_status: "paid" } } });
    assert.equal(ev.kind === "succeeded" && ev.paymentId, "pay_9");
  });

  test("form encoding + checkout params (ACH uses us_bank_account)", () => {
    assert.deepEqual(toStripeForm({ a: { b: [1, { c: "x y" }] } }), ["a%5Bb%5D%5B0%5D=1", "a%5Bb%5D%5B1%5D%5Bc%5D=x%20y"]);
    const p = buildCheckoutParams({
      paymentId: "pay_1",
      residentId: "r1",
      amountCents: 75000,
      method: "ACH",
      description: "Rent",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
    });
    assert.deepEqual(p.payment_method_types, ["us_bank_account"]);
    assert.ok(toStripeForm(p).includes("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=75000"));
  });

  test("provider calls Stripe with idempotency key + parses webhook", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.com/c/cs_test_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const stripe = new StripePaymentProvider("sk_test_abc", secret, fakeFetch);
    assert.ok(stripe.isSandbox);
    const session = await stripe.createCheckout({
      paymentId: "pay_1",
      residentId: "r1",
      amountCents: 75000,
      method: "CREDIT_CARD",
      description: "Rent",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
    });
    assert.equal(session.providerRef, "cs_test_1");
    assert.equal((calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"], "checkout-pay_1");

    const body = JSON.stringify({ id: "evt_2", type: "checkout.session.completed", data: { object: { metadata: { paymentId: "pay_1" }, payment_intent: "pi_1", payment_status: "paid" } } });
    const headers = new Headers({ "stripe-signature": buildStripeSignatureHeader(body, secret, Math.floor(Date.now() / 1000)) });
    const event = await stripe.parseWebhook(body, headers);
    assert.equal(event.kind, "succeeded");
    await assert.rejects(stripe.parseWebhook(body, new Headers({ "stripe-signature": "t=1,v1=00" })));
    await assert.rejects(stripe.refund({ paymentId: "pay_1", providerRef: "cs_test_1", amountCents: 1 }), /payment intent/);
  });

  test("stripe errors surface as PaymentProviderError", async () => {
    const failing = (async () => new Response(JSON.stringify({ error: { message: "Your card was declined." } }), { status: 402 })) as unknown as typeof fetch;
    const stripe = new StripePaymentProvider("sk_live_x", secret, failing);
    assert.equal(stripe.isSandbox, false);
    await assert.rejects(
      stripe.createCheckout({ paymentId: "p", residentId: "r", amountCents: 1, method: "DEBIT_CARD", description: "d", successUrl: "s", cancelUrl: "c" }),
      /declined/,
    );
  });

  test("mock provider mirrors production (PayPal) unless configured", async () => {
    const { parseMethods } = await import("../../src/lib/payments/mock.ts");
    assert.deepEqual([...parseMethods(undefined)], ["PAYPAL"]);
    assert.deepEqual([...parseMethods("ach, debit_card, bogus")], ["ACH", "DEBIT_CARD"]);
    assert.deepEqual([...parseMethods("bogus")], ["PAYPAL"]);
  });

  test("mock provider", async () => {
    const mock = new MockPaymentProvider();
    const s = await mock.createCheckout({ paymentId: "pay_1", residentId: "r", amountCents: 100, method: "ACH", description: "d", successUrl: "s", cancelUrl: "c" });
    assert.equal(s.redirectUrl, "/pay/sandbox/pay_1");
    assert.equal((await mock.refund({ paymentId: "pay_1", providerRef: "x", amountCents: 100 })).refundRef, "mock_re_pay_1");
    await assert.rejects(mock.createCheckout({ paymentId: "p", residentId: "r", amountCents: 0, method: "ACH", description: "d", successUrl: "s", cancelUrl: "c" }));
  });
});

describe("client IP for rate limiting can't be forged", () => {
  test("uses the entry appended by our proxy, not the client-supplied left side", () => {
    assert.equal(clientIpFrom("6.6.6.6, 203.0.113.9", null, 1), "203.0.113.9");
    assert.equal(clientIpFrom("1.1.1.1, 2.2.2.2, 203.0.113.9", null, 1), "203.0.113.9");
    assert.equal(clientIpFrom("6.6.6.6, 203.0.113.9, 172.64.0.1", null, 2), "203.0.113.9", "Cloudflare in front = 2 hops");
    assert.equal(clientIpFrom("203.0.113.9", null, 1), "203.0.113.9");
    assert.equal(clientIpFrom(null, "198.51.100.4", 1), "198.51.100.4");
    assert.equal(clientIpFrom(null, null, 1), null);
    assert.equal(clientIpFrom("203.0.113.9", null, 0), "203.0.113.9", "invalid hop count falls back to 1");
  });
});
