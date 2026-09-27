/**
 * Sandbox provider for development/demo. Checkout redirects to an in-app
 * sandbox page (/pay/sandbox/<paymentId>) where the resident picks an outcome
 * (success / decline / ACH pending). No money moves, no card data is collected.
 */
import type { CheckoutRequest, CheckoutSession, PaymentProvider, ProviderEvent } from "./provider.ts";
import { PaymentProviderError } from "./provider.ts";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "MOCK" as const;
  readonly isSandbox = true;
  readonly methods = ["PAYPAL", "DEBIT_CARD", "CREDIT_CARD", "ACH"] as const;

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
