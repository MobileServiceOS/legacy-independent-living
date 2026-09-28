import { env } from "../env";
import { MockPaymentProvider } from "./mock";
import { PayPalPaymentProvider } from "./paypal";
import type { PaymentProvider } from "./provider";
import { StripePaymentProvider } from "./stripe";

/**
 * Online payments are either configured (a live provider) or not set up yet.
 * "Not set up" is a normal state — e.g. a fresh deploy before PayPal keys
 * exist: the portal runs, residents are told to pay the office, offline
 * payments work, and the owner sees what to configure under Settings.
 */
export type PaymentsStatus = { configured: true; provider: PaymentProvider } | { configured: false; reason: string };

let cached: PaymentsStatus | null = null;

function build(): PaymentProvider {
  const which = env.paymentsProvider;
  return which === "paypal"
    ? new PayPalPaymentProvider(env.paypal)
    : which === "stripe"
      ? new StripePaymentProvider(env.stripeSecretKey, env.stripeWebhookSecret)
      : new MockPaymentProvider();
}

export function paymentsStatus(): PaymentsStatus {
  if (cached) return cached;
  try {
    cached = { configured: true, provider: build() };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[payments] online payments are not set up: ${reason}`);
    cached = { configured: false, reason };
  }
  return cached;
}

export class PaymentsNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`Online payments are not set up: ${reason}`);
    this.name = "PaymentsNotConfiguredError";
  }
}

/** The active provider. Throws PaymentsNotConfiguredError when none is configured — check paymentsStatus() first where that is expected. */
export function getPaymentProvider(): PaymentProvider {
  const s = paymentsStatus();
  if (!s.configured) throw new PaymentsNotConfiguredError(s.reason);
  return s.provider;
}

/** Test hook: force a provider (or null to re-read the environment). */
export function setPaymentProviderForTests(p: PaymentProvider | null) {
  cached = p ? { configured: true, provider: p } : null;
}

export type { PaymentProvider, ProviderEvent, CheckoutRequest } from "./provider";
