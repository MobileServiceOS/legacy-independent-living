/* eslint-disable @typescript-eslint/no-explicit-any -- inspecting loosely-typed PayPal JSON in assertions */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderBody, centsToPayPalValue, mapPayPalWebhook, PayPalPaymentProvider } from "../../src/lib/payments/paypal.ts";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** Minimal fake of the PayPal REST API. */
function fakePayPal(routes: Record<string, (body: unknown, call: Call) => { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const call: Call = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body,
    };
    calls.push(call);
    if (path === "/v1/oauth2/token") return new Response(JSON.stringify({ access_token: "A21-token", expires_in: 32400 }), { status: 200 });
    const key = `${call.method} ${path}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ message: `no route ${key}` }), { status: 404 });
    const r = handler(call.body, call);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const cfg = { clientId: "cid", clientSecret: "secret", webhookId: "WH-1", env: "sandbox" as const };
const checkout = {
  paymentId: "pay_1",
  residentId: "r1",
  amountCents: 75000,
  method: "PAYPAL" as const,
  description: "Rent payment — Legacy Independent Living",
  reference: "LIL-20260927-ABCDEF",
  customerEmail: "casey@example.test",
  successUrl: "https://portal.test/api/pay/return?payment=pay_1",
  cancelUrl: "https://portal.test/api/pay/cancel?payment=pay_1",
};

describe("PayPal adapter", () => {
  test("amounts are exact decimal strings (no float)", () => {
    assert.equal(centsToPayPalValue(75000), "750.00");
    assert.equal(centsToPayPalValue(29), "0.29");
    assert.equal(centsToPayPalValue(123456), "1234.56");
    assert.throws(() => centsToPayPalValue(0));
    assert.throws(() => centsToPayPalValue(1.5));
  });

  test("order body: capture intent, our ids, no shipping, return/cancel URLs", () => {
    const b = buildOrderBody(checkout, "Legacy Independent Living") as any;
    assert.equal(b.intent, "CAPTURE");
    assert.equal(b.purchase_units[0].custom_id, "pay_1");
    assert.equal(b.purchase_units[0].invoice_id, "LIL-20260927-ABCDEF");
    assert.deepEqual(b.purchase_units[0].amount, { currency_code: "USD", value: "750.00" });
    assert.equal(b.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
    assert.equal(b.payment_source.paypal.experience_context.return_url, checkout.successUrl);
  });

  test("createCheckout → approval link, OAuth + idempotency header, sandbox host", async () => {
    const { calls, fetchImpl } = fakePayPal({
      "POST /v2/checkout/orders": () => ({
        status: 200,
        json: { id: "ORDER-1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1" }] },
      }),
    });
    const pp = new PayPalPaymentProvider(cfg, fetchImpl);
    assert.ok(pp.isSandbox);
    assert.deepEqual([...pp.methods], ["PAYPAL"]);
    const s = await pp.createCheckout(checkout);
    assert.deepEqual(s, { providerRef: "ORDER-1", redirectUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1" });
    assert.ok(calls[0]!.url.startsWith("https://api-m.sandbox.paypal.com/v1/oauth2/token"));
    assert.equal(calls[0]!.headers.Authorization, `Basic ${Buffer.from("cid:secret").toString("base64")}`);
    assert.equal(calls[1]!.headers["PayPal-Request-Id"], "order-pay_1");
    assert.equal(calls[1]!.headers.Authorization, "Bearer A21-token");
  });

  test("token is cached between calls", async () => {
    const { calls, fetchImpl } = fakePayPal({
      "POST /v2/checkout/orders": () => ({ json: { id: "O", links: [{ rel: "payer-action", href: "https://x" }] } }),
    });
    const pp = new PayPalPaymentProvider(cfg, fetchImpl);
    await pp.createCheckout(checkout);
    await pp.createCheckout({ ...checkout, paymentId: "pay_2" });
    assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1);
  });

  test("live env uses the live API host", async () => {
    const { calls, fetchImpl } = fakePayPal({ "POST /v2/checkout/orders": () => ({ json: { id: "O", links: [{ rel: "approve", href: "https://x" }] } }) });
    const pp = new PayPalPaymentProvider({ ...cfg, env: "live" }, fetchImpl);
    assert.equal(pp.isSandbox, false);
    await pp.createCheckout(checkout);
    assert.ok(calls[0]!.url.startsWith("https://api-m.paypal.com/"));
  });

  test("capture COMPLETED → succeeded with capture id (used for refunds)", async () => {
    const { calls, fetchImpl } = fakePayPal({
      "POST /v2/checkout/orders/ORDER-1/capture": () => ({
        status: 201,
        json: { id: "ORDER-1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "COMPLETED", custom_id: "pay_1" }] } }] },
      }),
    });
    const ev = await new PayPalPaymentProvider(cfg, fetchImpl).completeReturn({ paymentId: "pay_1", providerRef: "ORDER-1" });
    assert.equal(ev.kind, "succeeded");
    assert.equal(ev.kind === "succeeded" && ev.providerRef, "CAP-1");
    assert.equal(ev.kind === "succeeded" && ev.cardBrand, "PayPal");
    assert.equal(calls.at(-1)!.headers["PayPal-Request-Id"], "capture-pay_1");
  });

  test("guest card checkout records brand + last 4 only", async () => {
    const { fetchImpl } = fakePayPal({
      "POST /v2/checkout/orders/O/capture": () => ({
        json: { id: "O", payment_source: { card: { last_digits: "1111", brand: "VISA" } }, purchase_units: [{ payments: { captures: [{ id: "C", status: "COMPLETED" }] } }] },
      }),
    });
    const ev = await new PayPalPaymentProvider(cfg, fetchImpl).completeReturn({ paymentId: "p", providerRef: "O" });
    assert.ok(ev.kind === "succeeded" && ev.cardBrand === "Visa" && ev.last4 === "1111");
  });

  test("capture PENDING (eCheck) → processing; DECLINED → failed; instrument declined → failed", async () => {
    const mk = (json: unknown, status = 201) => fakePayPal({ "POST /v2/checkout/orders/O/capture": () => ({ status, json }) }).fetchImpl;
    const pending = await new PayPalPaymentProvider(cfg, mk({ purchase_units: [{ payments: { captures: [{ id: "C", status: "PENDING", status_details: { reason: "ECHECK" } }] } }] })).completeReturn({ paymentId: "p", providerRef: "O" });
    assert.equal(pending.kind, "processing");
    const declined = await new PayPalPaymentProvider(cfg, mk({ purchase_units: [{ payments: { captures: [{ id: "C", status: "DECLINED" }] } }] })).completeReturn({ paymentId: "p", providerRef: "O" });
    assert.equal(declined.kind, "failed");
    const instrument = await new PayPalPaymentProvider(cfg, mk({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] }, 422)).completeReturn({ paymentId: "p", providerRef: "O" });
    assert.equal(instrument.kind, "failed");
  });

  test("already-captured order (refresh / double return) reads the order instead", async () => {
    const { fetchImpl } = fakePayPal({
      "POST /v2/checkout/orders/O/capture": () => ({ status: 422, json: { details: [{ issue: "ORDER_ALREADY_CAPTURED" }] } }),
      "GET /v2/checkout/orders/O": () => ({ json: { id: "O", purchase_units: [{ payments: { captures: [{ id: "C9", status: "COMPLETED" }] } }] } }),
    });
    const ev = await new PayPalPaymentProvider(cfg, fetchImpl).completeReturn({ paymentId: "p", providerRef: "O" });
    assert.ok(ev.kind === "succeeded" && ev.providerRef === "C9");
  });

  test("refund hits the capture with the exact amount", async () => {
    const { calls, fetchImpl } = fakePayPal({ "POST /v2/payments/captures/CAP-1/refund": () => ({ status: 201, json: { id: "REF-1", status: "COMPLETED" } }) });
    const r = await new PayPalPaymentProvider(cfg, fetchImpl).refund({ paymentId: "pay_1", providerRef: "CAP-1", amountCents: 75000 });
    assert.equal(r.refundRef, "REF-1");
    assert.deepEqual((calls.at(-1)!.body as any).amount, { currency_code: "USD", value: "750.00" });
  });

  test("API errors surface as PaymentProviderError", async () => {
    const { fetchImpl } = fakePayPal({ "POST /v2/checkout/orders": () => ({ status: 400, json: { details: [{ description: "Invoice ID was previously used." }] } }) });
    await assert.rejects(new PayPalPaymentProvider(cfg, fetchImpl).createCheckout(checkout), /previously used/);
    assert.throws(() => new PayPalPaymentProvider({ ...cfg, clientSecret: "" }), /PAYPAL_CLIENT_SECRET/);
  });
});

describe("PayPal webhooks", () => {
  const headers = new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "t1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-09-27T20:00:00Z",
  });
  const body = JSON.stringify({ id: "WH-EVT-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP-1", status: "COMPLETED", custom_id: "pay_1" } });

  test("verified via PayPal's API with our webhook id", async () => {
    const { calls, fetchImpl } = fakePayPal({ "POST /v1/notifications/verify-webhook-signature": () => ({ json: { verification_status: "SUCCESS" } }) });
    const ev = await new PayPalPaymentProvider(cfg, fetchImpl).parseWebhook(body, headers);
    assert.deepEqual(ev, { kind: "succeeded", paymentId: "pay_1", providerRef: "CAP-1", eventId: "WH-EVT-1", cardBrand: "PayPal" });
    const sent = calls.at(-1)!.body as any;
    assert.equal(sent.webhook_id, "WH-1");
    assert.equal(sent.transmission_id, "t1");
  });

  test("rejects failed verification, missing headers, foreign cert host, no webhook id", async () => {
    const bad = fakePayPal({ "POST /v1/notifications/verify-webhook-signature": () => ({ json: { verification_status: "FAILURE" } }) }).fetchImpl;
    await assert.rejects(new PayPalPaymentProvider(cfg, bad).parseWebhook(body, headers), /could not be verified/);
    await assert.rejects(new PayPalPaymentProvider(cfg, bad).parseWebhook(body, new Headers()), /Missing PayPal signature/);
    const evil = new Headers(headers);
    evil.set("paypal-cert-url", "https://evil.example/cert");
    await assert.rejects(new PayPalPaymentProvider(cfg, bad).parseWebhook(body, evil), /Untrusted/);
    await assert.rejects(new PayPalPaymentProvider({ ...cfg, webhookId: "" }, bad).parseWebhook(body, headers), /PAYPAL_WEBHOOK_ID/);
  });

  test("event mapping", () => {
    const ev = (event_type: string, resource: object) => mapPayPalWebhook({ id: "E", event_type, resource: resource as Record<string, unknown> });
    assert.equal(ev("PAYMENT.CAPTURE.PENDING", { id: "C", custom_id: "p" }).kind, "processing");
    assert.equal(ev("PAYMENT.CAPTURE.DENIED", { id: "C", custom_id: "p" }).kind, "failed");
    const refund = ev("PAYMENT.CAPTURE.REFUNDED", { id: "REF", links: [{ rel: "up", href: "https://api.paypal.com/v2/payments/captures/CAP-7" }] });
    assert.ok(refund.kind === "refunded" && refund.providerRef === "CAP-7");
    assert.equal(ev("CHECKOUT.ORDER.APPROVED", {}).kind, "ignored");
  });
});
