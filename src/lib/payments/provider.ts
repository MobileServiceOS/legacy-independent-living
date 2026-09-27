/**
 * Payment-provider abstraction. The app NEVER touches card numbers or bank
 * credentials: providers host the checkout page and we only store their
 * opaque references (order / capture ids, brand, last4).
 *
 * To add a processor: implement PaymentProvider and register it in
 * getPaymentProvider() (src/lib/payments/index.ts).
 */
import type { Cents } from "../../domain/money.ts";
import type { PaymentMethodType } from "../../domain/payments.ts";

export type ProviderName = "MOCK" | "STRIPE" | "PAYPAL";
export type OnlineMethod = Extract<PaymentMethodType, "PAYPAL" | "ACH" | "DEBIT_CARD" | "CREDIT_CARD">;

export interface CheckoutRequest {
  paymentId: string;
  residentId: string;
  amountCents: Cents;
  method: OnlineMethod;
  description: string;
  /** Unique, human-readable reference shown on the processor side (our receipt number). */
  reference?: string;
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
  /** Online methods residents can choose, in display order. */
  readonly methods: readonly OnlineMethod[];
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Called when the resident comes back from the processor (redirect flows like
   * PayPal, where the server must capture the approved order). Returns the result.
   */
  completeReturn?(req: { paymentId: string; providerRef: string }): Promise<ProviderEvent>;
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
