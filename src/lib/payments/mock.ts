/**
 * Sandbox provider for development/demo. Checkout redirects to an in-app
 * sandbox page (/pay/sandbox/<paymentId>) where the resident picks an outcome
 * (success / decline / ACH pending). No money moves, no card data is collected.
 */
import type { CheckoutRequest, CheckoutSession, OnlineMethod, PaymentProvider, ProviderEvent } from "./provider.ts";

const ALL: readonly OnlineMethod[] = ["DEBIT_CARD", "CREDIT_CARD", "CASH_APP", "ACH", "PAYPAL"];
/** Mirrors production (Stripe: cards, Cash App Pay, bank account). */
const DEFAULT: readonly OnlineMethod[] = ["DEBIT_CARD", "CREDIT_CARD", "CASH_APP", "ACH"];

export function parseMethods(value: string | undefined): readonly OnlineMethod[] {
  const picked = (value ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is OnlineMethod => (ALL as readonly string[]).includes(s));
  return picked.length ? picked : DEFAULT;
}
import { PaymentProviderError } from "./provider.ts";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "MOCK" as const;
  readonly isSandbox = true;
  /** Mirrors production (Stripe) by default; MOCK_PAYMENT_METHODS="PAYPAL" etc. to demo others. */
  readonly methods: readonly OnlineMethod[] = parseMethods(process.env.MOCK_PAYMENT_METHODS);

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    if (req.amountCents <= 0) throw new PaymentProviderError("Amount must be positive");
    return { providerRef: `mock_cs_${req.paymentId}`, redirectUrl: `/pay/sandbox/${encodeURIComponent(req.paymentId)}` };
  }

  async refund(req: { paymentId: string; providerRef: string; amountCents: number }): Promise<{ refundRef: string }> {
    if (req.amountCents <= 0) throw new PaymentProviderError("Refund must be positive");
    return { refundRef: `mock_re_${req.paymentId}` };
  }

  async parseWebhook(): Promise<ProviderEvent> {
    throw new PaymentProviderError("The sandbox provider does not receive webhooks");
  }
}
