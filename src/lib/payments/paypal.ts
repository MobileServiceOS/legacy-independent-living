/**
 * PayPal provider — Orders API v2 with server-side capture.
 *
 * Flow:
 *   1. createCheckout → POST /v2/checkout/orders (intent CAPTURE). Resident is sent to
 *      PayPal's approve page, where they pay with PayPal balance, a linked bank, or a
 *      debit/credit card (guest checkout). Card/bank details never reach this app.
 *   2. PayPal redirects back to /api/pay/paypal/return → completeReturn → capture
 *      (POST /v2/checkout/orders/{id}/capture, idempotent via PayPal-Request-Id).
 *        COMPLETED → succeeded   PENDING (e.g. eCheck) → processing   DECLINED → failed
 *   3. Webhooks (verified via PayPal's verify-webhook-signature API) are the backstop:
 *      PAYMENT.CAPTURE.COMPLETED / PENDING / DENIED / DECLINED / REFUNDED / REVERSED.
 *   4. Refunds: POST /v2/payments/captures/{captureId}/refund. After capture the
 *      payment's providerRef is the capture id.
 *
 * Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_ENV=sandbox|live
 */
import type { CheckoutRequest, CheckoutSession, PaymentProvider, ProviderEvent } from "./provider.ts";
import { PaymentProviderError } from "./provider.ts";

export const PAYPAL_API = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" } as const;

export function centsToPayPalValue(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new PaymentProviderError("Amount must be a positive number of cents");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

type Json = Record<string, unknown>;
type Capture = {
  id?: string;
  status?: string;
  custom_id?: string;
  status_details?: { reason?: string };
  links?: Array<{ rel?: string; href?: string }>;
  supplementary_data?: { related_ids?: { order_id?: string } };
};
type Order = {
  id?: string;
  status?: string;
  payment_source?: { card?: { last_digits?: string; brand?: string }; paypal?: Json };
  purchase_units?: Array<{ custom_id?: string; payments?: { captures?: Capture[] } }>;
  links?: Array<{ rel?: string; href?: string }>;
  details?: Array<{ issue?: string; description?: string }>;
  name?: string;
  message?: string;
};

export function buildOrderBody(req: CheckoutRequest, brandName: string): Json {
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: req.paymentId,
        custom_id: req.paymentId, // comes back on captures + webhooks
        invoice_id: req.reference ?? req.paymentId, // PayPal rejects duplicates → no double charge per receipt
        description: req.description.slice(0, 127),
        amount: { currency_code: "USD", value: centsToPayPalValue(req.amountCents) },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: brandName.slice(0, 127),
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          landing_page: "LOGIN",
          return_url: req.successUrl,
          cancel_url: req.cancelUrl,
        },
        ...(req.customerEmail ? { email_address: req.customerEmail } : {}),
      },
    },
  };
}

/** Normalize a capture status into our event model. */
export function mapCapture(capture: Capture, paymentId: string | null, eventId: string, card?: { last_digits?: string; brand?: string }): ProviderEvent {
  const ref = capture.id ?? null;
  switch (capture.status) {
    case "COMPLETED":
      return { kind: "succeeded", paymentId, providerRef: ref, eventId, cardBrand: card?.brand ? titleCase(card.brand) : "PayPal", last4: card?.last_digits ?? null };
    case "PENDING":
      return { kind: "processing", paymentId, providerRef: ref, eventId };
    case "DECLINED":
    case "FAILED":
      return { kind: "failed", paymentId, providerRef: ref, eventId, reason: paypalReason(capture.status_details?.reason) };
    case "REFUNDED":
      return { kind: "refunded", paymentId, providerRef: ref, eventId };
    default:
      return { kind: "ignored", eventId, type: `capture.${capture.status ?? "unknown"}` };
  }
}

function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function paypalReason(code?: string): string {
  const map: Record<string, string> = {
    ECHECK: "Bank payment is still clearing",
    DECLINED_BY_RISK_FRAUD_CONTROLS: "PayPal declined the payment",
    PAYER_SHIPPING_UNCONFIRMED: "PayPal could not confirm the payment",
    RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION: "Payment needs to be accepted in the PayPal account",
  };
  return (code && map[code]) || "PayPal declined the payment";
}

/** Map a verified PayPal webhook event. Pure + unit-tested. */
export function mapPayPalWebhook(event: { id: string; event_type: string; resource: Json }): ProviderEvent {
  const r = event.resource as Capture & { custom_id?: string };
  const paymentId = r.custom_id ?? null;
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED":
      return { kind: "succeeded", paymentId, providerRef: r.id ?? null, eventId: event.id, cardBrand: "PayPal" };
    case "PAYMENT.CAPTURE.PENDING":
      return { kind: "processing", paymentId, providerRef: r.id ?? null, eventId: event.id };
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED":
      return { kind: "failed", paymentId, providerRef: r.id ?? null, eventId: event.id, reason: paypalReason(r.status_details?.reason) };
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      // Resource is the refund; the capture id is in its "up" link.
      const up = r.links?.find((l) => l.rel === "up")?.href ?? "";
      const captureId = /\/captures\/([^/?]+)/.exec(up)?.[1] ?? null;
      return { kind: "refunded", paymentId, providerRef: captureId, eventId: event.id };
    }
    case "CHECKOUT.ORDER.VOIDED":
      return { kind: "canceled", paymentId: null, providerRef: r.id ?? null, eventId: event.id };
    default:
      return { kind: "ignored", eventId: event.id, type: event.event_type };
  }
}

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  env: "sandbox" | "live";
  brandName?: string;
}

export class PayPalPaymentProvider implements PaymentProvider {
  readonly name = "PAYPAL" as const;
  readonly isSandbox: boolean;
  readonly methods = ["PAYPAL"] as const;
  private readonly cfg: PayPalConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(cfg: PayPalConfig, fetchImpl: typeof fetch = fetch) {
    if (!cfg.clientId || !cfg.clientSecret) throw new PaymentProviderError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required");
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
    this.isSandbox = cfg.env !== "live";
    this.base = PAYPAL_API[cfg.env === "live" ? "live" : "sandbox"];
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchImpl(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !json.access_token) throw new PaymentProviderError(`PayPal authentication failed: ${json.error_description ?? res.status}`, res.status >= 500);
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 300) * 1000 };
    return this.token.value;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: Json, requestId?: string): Promise<{ status: number; json: T }> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = (text ? JSON.parse(text) : {}) as T;
    return { status: res.status, json };
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const { status, json } = await this.call<Order>("POST", "/v2/checkout/orders", buildOrderBody(req, this.cfg.brandName ?? "Legacy Independent Living"), `order-${req.paymentId}`);
    if (status >= 400 || !json.id) throw new PaymentProviderError(json.details?.[0]?.description ?? json.message ?? `PayPal error ${status}`, status >= 500);
    const approve = json.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    if (!approve) throw new PaymentProviderError("PayPal did not return an approval link");
    return { providerRef: json.id, redirectUrl: approve };
  }

  /** Capture the approved order. Safe to call twice (idempotent request id + already-captured handling). */
  async completeReturn(req: { paymentId: string; providerRef: string }): Promise<ProviderEvent> {
    const orderId = req.providerRef;
    let { status, json } = await this.call<Order>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${req.paymentId}`);
    if (status === 422 && json.details?.some((d) => d.issue === "ORDER_ALREADY_CAPTURED")) {
      ({ status, json } = await this.call<Order>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`));
    }
    if (status === 422 && json.details?.some((d) => d.issue === "INSTRUMENT_DECLINED")) {
      return { kind: "failed", paymentId: req.paymentId, providerRef: orderId, eventId: `paypal:capture:${orderId}:declined`, reason: "Your payment method was declined. Please try another." };
    }
    if (status >= 400) throw new PaymentProviderError(json.details?.[0]?.description ?? json.message ?? `PayPal capture error ${status}`, status >= 500);
    const capture = json.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture) return { kind: "processing", paymentId: req.paymentId, providerRef: orderId, eventId: `paypal:capture:${orderId}:none` };
    return mapCapture(capture, req.paymentId, `paypal:capture:${capture.id}:${capture.status}`, json.payment_source?.card);
  }

  async refund(req: { paymentId: string; providerRef: string; amountCents: number }): Promise<{ refundRef: string }> {
    const { status, json } = await this.call<{ id?: string; status?: string; message?: string; details?: Array<{ description?: string }> }>(
      "POST",
      `/v2/payments/captures/${encodeURIComponent(req.providerRef)}/refund`,
      { amount: { currency_code: "USD", value: centsToPayPalValue(req.amountCents) }, note_to_payer: "Refund from Legacy Independent Living" },
      `refund-${req.paymentId}`,
    );
    if (status >= 400 || !json.id) throw new PaymentProviderError(json.details?.[0]?.description ?? json.message ?? `PayPal refund error ${status}`, status >= 500);
    return { refundRef: json.id };
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent> {
    if (!this.cfg.webhookId) throw new PaymentProviderError("PAYPAL_WEBHOOK_ID is not set");
    const h = (n: string) => headers.get(n);
    const required = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
    if (required.some((n) => !h(n))) throw new PaymentProviderError("Missing PayPal signature headers");
    const certUrl = h("paypal-cert-url")!;
    if (!/^https:\/\/api(-m)?\.(sandbox\.)?paypal\.com\//.test(certUrl)) throw new PaymentProviderError("Untrusted PayPal cert URL");
    let event: { id: string; event_type: string; resource: Json };
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new PaymentProviderError("Invalid JSON");
    }
    const { status, json } = await this.call<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h("paypal-auth-algo"),
      cert_url: certUrl,
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: this.cfg.webhookId,
      webhook_event: event,
    });
    if (status >= 400 || json.verification_status !== "SUCCESS") throw new PaymentProviderError("PayPal webhook signature could not be verified");
    return mapPayPalWebhook(event);
  }
}
