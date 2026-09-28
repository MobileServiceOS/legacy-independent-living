/**
 * Stripe provider using hosted Checkout Sessions: debit/credit cards, Cash App
 * Pay, and US bank accounts (ACH). Card/bank details are entered on Stripe's
 * page — they never reach this app. Implemented against Stripe's REST API with
 * fetch (no SDK dependency).
 *
 * Flow: create session → resident pays on Stripe → returns to /api/pay/return,
 * where the server retrieves the session and settles (webhooks are the backup).
 *
 * Required env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 * Optional: STRIPE_METHODS="DEBIT_CARD,CREDIT_CARD,CASH_APP,ACH" (order shown to residents)
 * Webhook endpoint: POST /api/webhooks/stripe, subscribe to:
 *   checkout.session.completed, checkout.session.async_payment_succeeded,
 *   checkout.session.async_payment_failed, checkout.session.expired, charge.refunded
 */
import type { CheckoutRequest, CheckoutSession, EventFacts, OnlineMethod, PaymentProvider, ProviderEvent } from "./provider.ts";
import { PaymentProviderError } from "./provider.ts";
import { verifyStripeSignature } from "./stripe-signature.ts";

const API = "https://api.stripe.com/v1";

/** Encode nested params the way Stripe expects: a[b][0]=c */
export function toStripeForm(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === "object") out.push(...toStripeForm(v as Record<string, unknown>, `${name}[${i}]`));
        else out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(v))}`);
      });
    } else if (typeof value === "object") {
      out.push(...toStripeForm(value as Record<string, unknown>, name));
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

const STRIPE_TYPE: Record<Exclude<OnlineMethod, "PAYPAL">, string> = {
  DEBIT_CARD: "card",
  CREDIT_CARD: "card",
  CASH_APP: "cashapp",
  ACH: "us_bank_account",
};
const STRIPE_METHODS: readonly Exclude<OnlineMethod, "PAYPAL">[] = ["DEBIT_CARD", "CREDIT_CARD", "CASH_APP", "ACH"];

/** Which methods residents see, in order. Unknown names are ignored; empty → all. */
export function parseStripeMethods(value: string | undefined): readonly Exclude<OnlineMethod, "PAYPAL">[] {
  const picked = (value ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s, i, a): s is Exclude<OnlineMethod, "PAYPAL"> => (STRIPE_METHODS as readonly string[]).includes(s) && a.indexOf(s) === i);
  return picked.length ? picked : STRIPE_METHODS;
}

export function buildCheckoutParams(req: CheckoutRequest): Record<string, unknown> {
  if (req.method === "PAYPAL") throw new PaymentProviderError("PayPal is not a Stripe payment method");
  return {
    mode: "payment",
    payment_method_types: [STRIPE_TYPE[req.method]],
    line_items: [
      {
        quantity: 1,
        price_data: { currency: "usd", unit_amount: req.amountCents, product_data: { name: req.description } },
      },
    ],
    client_reference_id: req.paymentId,
    customer_email: req.customerEmail ?? undefined,
    success_url: req.successUrl,
    cancel_url: req.cancelUrl,
    metadata: { paymentId: req.paymentId, residentId: req.residentId },
    payment_intent_data: { metadata: { paymentId: req.paymentId, residentId: req.residentId } },
  };
}

type StripeObject = Record<string, unknown> & { metadata?: Record<string, string> };

const idOf = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

/** Amount/currency/session a Checkout Session proves. */
function sessionFacts(obj: StripeObject, isSession: boolean): EventFacts {
  return {
    amountCents: typeof obj.amount_total === "number" ? obj.amount_total : null,
    currency: typeof obj.currency === "string" ? obj.currency.toUpperCase() : null,
    orderId: isSession && typeof obj.id === "string" ? obj.id : null,
  };
}

/** Card brand + last 4 (or "Cash App") from an expanded payment intent, when available. */
function chargeDetails(pi: unknown): { cardBrand: string | null; last4: string | null } {
  const charge = (pi as { latest_charge?: { payment_method_details?: { type?: string; card?: { brand?: string; last4?: string } } } } | null)?.latest_charge;
  const d = charge && typeof charge === "object" ? charge.payment_method_details : undefined;
  if (d?.type === "card" && d.card) return { cardBrand: d.card.brand ? d.card.brand.charAt(0).toUpperCase() + d.card.brand.slice(1) : null, last4: d.card.last4 ?? null };
  if (d?.type === "cashapp") return { cardBrand: "Cash App", last4: null };
  if (d?.type === "us_bank_account") return { cardBrand: "Bank account", last4: null };
  return { cardBrand: null, last4: null };
}

/** Map a retrieved Checkout Session (on the resident's return) to our event model. */
export function mapStripeSession(session: StripeObject, paymentId: string): ProviderEvent {
  const intent = idOf(session.payment_intent);
  const facts = sessionFacts(session, true);
  const sid = String(session.id ?? "");
  if (session.status === "complete" && session.payment_status === "paid")
    return { kind: "succeeded", paymentId, providerRef: intent, eventId: `stripe:return:${sid}:paid`, facts, ...chargeDetails(session.payment_intent) };
  if (session.status === "complete") return { kind: "processing", paymentId, providerRef: intent, eventId: `stripe:return:${sid}:processing`, facts };
  if (session.status === "expired") return { kind: "canceled", paymentId, providerRef: sid, eventId: `stripe:return:${sid}:expired`, facts };
  return { kind: "ignored", eventId: `stripe:return:${sid}:open`, type: "checkout.session.open" };
}

/** Map a verified Stripe event to our normalized ProviderEvent. Pure + tested. */
export function mapStripeEvent(event: { id: string; type: string; data: { object: StripeObject } }): ProviderEvent {
  const obj = event.data.object;
  const paymentId = (obj.metadata?.paymentId as string | undefined) ?? (obj.client_reference_id as string | undefined) ?? null;
  const intent = idOf(obj.payment_intent);
  const facts = sessionFacts(obj, event.type.startsWith("checkout.session."));
  switch (event.type) {
    case "checkout.session.completed":
      if (obj.payment_status === "paid") return { kind: "succeeded", paymentId, providerRef: intent, eventId: event.id, facts };
      return { kind: "processing", paymentId, providerRef: intent, eventId: event.id, facts }; // ACH: funds not yet cleared
    case "checkout.session.async_payment_succeeded":
      return { kind: "succeeded", paymentId, providerRef: intent, eventId: event.id, facts };
    case "checkout.session.async_payment_failed":
      return { kind: "failed", paymentId, providerRef: intent, eventId: event.id, reason: "Bank payment failed", facts };
    case "checkout.session.expired":
      return { kind: "canceled", paymentId, providerRef: intent ?? (typeof obj.id === "string" ? obj.id : null), eventId: event.id, facts };
    case "charge.refunded":
      if (obj.refunded === true) return { kind: "refunded", paymentId, providerRef: intent, eventId: event.id, facts };
      return { kind: "ignored", eventId: event.id, type: event.type };
    default:
      return { kind: "ignored", eventId: event.id, type: event.type };
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "STRIPE" as const;
  readonly isSandbox: boolean;
  readonly methods: readonly OnlineMethod[];
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(secretKey: string, webhookSecret: string, fetchImpl: typeof fetch = fetch, methods: readonly OnlineMethod[] = parseStripeMethods(process.env.STRIPE_METHODS)) {
    if (!secretKey) throw new PaymentProviderError("STRIPE_SECRET_KEY is not set");
    if (!/^(sk|rk)_(test|live)_/.test(secretKey)) throw new PaymentProviderError("STRIPE_SECRET_KEY must be a secret key (sk_live_… or sk_test_…), not a publishable key");
    if (!webhookSecret) throw new PaymentProviderError("STRIPE_WEBHOOK_SECRET is not set (Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret)");
    this.methods = methods;
    this.secretKey = secretKey;
    this.webhookSecret = webhookSecret;
    this.fetchImpl = fetchImpl;
    this.isSandbox = secretKey.includes("_test_");
  }

  private async post(path: string, params: Record<string, unknown>, idempotencyKey: string): Promise<StripeObject> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body: toStripeForm(params).join("&"),
    });
    return this.parse(res);
  }

  private async get(path: string): Promise<StripeObject> {
    const res = await this.fetchImpl(`${API}${path}`, { method: "GET", headers: { Authorization: `Bearer ${this.secretKey}` } });
    return this.parse(res);
  }

  private async parse(res: Response): Promise<StripeObject> {
    const json = (await res.json()) as StripeObject & { error?: { message?: string; param?: string } };
    if (!res.ok) {
      const msg = json.error?.message ?? `Stripe error ${res.status}`;
      // e.g. Cash App Pay / ACH not switched on in the Stripe Dashboard yet.
      const methodOff = json.error?.param === "payment_method_types" || /payment method type/i.test(msg);
      throw new PaymentProviderError(msg, res.status >= 500, methodOff ? "That payment option isn't available right now. Please choose another one." : undefined);
    }
    return json;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const session = await this.post("/checkout/sessions", buildCheckoutParams(req), `checkout-${req.paymentId}`);
    if (typeof session.id !== "string" || typeof session.url !== "string")
      throw new PaymentProviderError("Stripe returned an invalid checkout session");
    return { providerRef: session.id, redirectUrl: session.url };
  }

  /** Resident returned from Stripe: read the session server-side and settle (webhooks are the backup). */
  async completeReturn(req: { paymentId: string; providerRef: string }): Promise<ProviderEvent> {
    if (!req.providerRef.startsWith("cs_")) {
      // Already settled to a payment intent by a webhook — nothing left to confirm here.
      return { kind: "ignored", eventId: `stripe:return:${req.paymentId}:settled`, type: "already_settled" };
    }
    const session = await this.get(`/checkout/sessions/${encodeURIComponent(req.providerRef)}?expand[]=payment_intent.latest_charge`);
    return mapStripeSession(session, req.paymentId);
  }

  /** Expire an unpaid Checkout Session so it can't be completed after we mark the payment canceled. */
  async cancelCheckout(req: { paymentId: string; providerRef: string }): Promise<void> {
    if (!req.providerRef.startsWith("cs_")) throw new PaymentProviderError("Payment already moved past checkout");
    const session = await this.get(`/checkout/sessions/${encodeURIComponent(req.providerRef)}`);
    if (session.status === "expired") return;
    if (session.status !== "open") throw new PaymentProviderError(`Checkout is ${String(session.status)}; not canceling`);
    await this.post(`/checkout/sessions/${encodeURIComponent(req.providerRef)}/expire`, {}, `expire-${req.paymentId}`);
  }

  async refund(req: { paymentId: string; providerRef: string; amountCents: number }): Promise<{ refundRef: string }> {
    if (!req.providerRef.startsWith("pi_")) throw new PaymentProviderError("Payment has no Stripe payment intent to refund");
    const refund = await this.post(
      "/refunds",
      { payment_intent: req.providerRef, amount: req.amountCents, metadata: { paymentId: req.paymentId } },
      `refund-${req.paymentId}`,
    );
    return { refundRef: String(refund.id) };
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent> {
    const check = verifyStripeSignature(rawBody, headers.get("stripe-signature"), this.webhookSecret);
    if (!check.ok) throw new PaymentProviderError(`Invalid Stripe signature: ${check.reason}`);
    return mapStripeEvent(JSON.parse(rawBody));
  }
}
