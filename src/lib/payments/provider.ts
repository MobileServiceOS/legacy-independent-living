/**
 * Payment-provider abstraction. The app NEVER touches card numbers or bank
 * credentials: providers host the checkout page and we only store their
 * opaque references (session / payment-intent ids, brand, last4).
 *
 * To add a processor: implement PaymentProvider and register it in
 * getPaymentProvider() (src/lib/payments/index.ts).
 */
import type { Cents } from "../../domain/money.ts";
import type { PaymentMethodType } from "../../domain/payments.ts";

export type ProviderName = "MOCK" | "STRIPE";
export type OnlineMethod = Extract<PaymentMethodType, "ACH" | "DEBIT_CARD" | "CREDIT_CARD">;

export interface CheckoutRequest {
  paymentId: string;
  residentId: string;
  amountCents: Cents;
  method: OnlineMethod;
  description: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Provider's id for the checkout (stored on the payment for reconciliation). */
  providerRef: string;
  /** Where to send the resident to complete payment. */
  redirectUrl: string;
}

/** Provider events normalized into the only facts our ledger cares about. */
export type ProviderEvent =
  | { kind: "processing"; paymentId: string | null; providerRef: string | null; eventId: string }
  | {
      kind: "succeeded";
      paymentId: string | null;
      providerRef: string | null;
      eventId: string;
      cardBrand?: string | null;
      last4?: string | null;
    }
  | { kind: "failed"; paymentId: string | null; providerRef: string | null; eventId: string; reason: string }
  | { kind: "canceled"; paymentId: string | null; providerRef: string | null; eventId: string }
  | { kind: "refunded"; paymentId: string | null; providerRef: string | null; eventId: string }
  | { kind: "ignored"; eventId: string; type: string };

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly isSandbox: boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  refund(req: { paymentId: string; providerRef: string; amountCents: Cents }): Promise<{ refundRef: string }>;
  /** Verify + parse a raw webhook. Throws on bad signature. */
  parseWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent>;
}

export class PaymentProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "PaymentProviderError";
    this.retryable = retryable;
  }
}
