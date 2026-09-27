import { env } from "../env";
import { MockPaymentProvider } from "./mock";
import type { PaymentProvider } from "./provider";
import { StripePaymentProvider } from "./stripe";

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;
  cached =
    env.paymentsProvider === "stripe"
      ? new StripePaymentProvider(env.stripeSecretKey, env.stripeWebhookSecret)
      : new MockPaymentProvider();
  return cached;
}

/** Test hook. */
export function setPaymentProviderForTests(p: PaymentProvider | null) {
  cached = p;
}

export type { PaymentProvider, ProviderEvent, CheckoutRequest } from "./provider";
