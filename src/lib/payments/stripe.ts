/**
 * Stripe provider using hosted Checkout Sessions (cards + US bank accounts via
 * ACH). Card/bank details are entered on Stripe's page — they never reach this
 * app. Implemented against Stripe's REST API with fetch (no SDK dependency).
 *
 * Required env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 * Webhook endpoint: POST /api/webhooks/stripe, subscribe to:
 *   checkout.session.completed, checkout.session.async_payment_succeeded,
 *   checkout.session.async_payment_failed, checkout.session.expired, charge.refunded
 */
import type { CheckoutRequest, CheckoutSession, PaymentProvider, ProviderEvent } from "./provider.ts";
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

export function buildCheckoutParams(req: CheckoutRequest): Record<string, unknown> {
  return {
    mode: "payment",
    payment_method_types: [req.method === "ACH" ? "us_bank_account" : "card"],
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

/** Map a verified Stripe event to our normalized ProviderEvent. Pure + tested. */
export function mapStripeEvent(event: { id: string; type: string; data: { object: StripeObject } }): ProviderEvent {
  const obj = event.data.object;
  const paymentId = (obj.metadata?.paymentId as string | undefined) ?? (obj.client_reference_id as string | undefined) ?? null;
  const intent = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
  switch (event.type) {
    case "checkout.session.completed":
      if (obj.payment_status === "paid") return { kind: "succeeded", paymentId, providerRef: intent, eventId: event.id };
      return { kind: "processing", paymentId, providerRef: intent, eventId: event.id }; // ACH: funds not yet cleared
    case "checkout.session.async_payment_succeeded":
      return { kind: "succeeded", paymentId, providerRef: intent, eventId: event.id };
    case "checkout.session.async_payment_failed":
      return { kind: "failed", paymentId, providerRef: intent, eventId: event.id, reason: "Bank payment failed" };
    case "checkout.session.expired":
      return { kind: "canceled", paymentId, providerRef: intent, eventId: event.id };
    case "charge.refunded":
      if (obj.refunded === true) return { kind: "refunded", paymentId, providerRef: intent, eventId: event.id };
      return { kind: "ignored", eventId: event.id, type: event.type };
    default:
      return { kind: "ignored", eventId: event.id, type: event.type };
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "STRIPE" as const;
  readonly isSandbox: boolean;
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(secretKey: string, webhookSecret: string, fetchImpl: typeof fetch = fetch) {
    if (!secretKey) throw new PaymentProviderError("STRIPE_SECRET_KEY is not set");
    this.secretKey = secretKey;
    this.webhookSecret = webhookSecret;
    this.fetchImpl = fetchImpl;
    this.isSandbox = secretKey.startsWith("sk_test_");
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
    const json = (await res.json()) as StripeObject & { error?: { message?: string } };
    if (!res.ok) throw new PaymentProviderError(json.error?.message ?? `Stripe error ${res.status}`, res.status >= 500);
    return json;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const session = await this.post("/checkout/sessions", buildCheckoutParams(req), `checkout-${req.paymentId}`);
    if (typeof session.id !== "string" || typeof session.url !== "string")
      throw new PaymentProviderError("Stripe returned an invalid checkout session");
    return { providerRef: session.id, redirectUrl: session.url };
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
