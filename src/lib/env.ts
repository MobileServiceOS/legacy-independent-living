/** Centralized, validated environment access. Secrets never leave the server. */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** Public base URL, used for payment return links + invite links. */
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  /**
   * "mock" (sandbox; default outside production), "paypal", or "stripe".
   * Throws with a setup hint when misconfigured — callers go through
   * paymentsStatus(), which turns that into "online payments not set up"
   * instead of breaking pages.
   */
  get paymentsProvider(): "mock" | "paypal" | "stripe" {
    const production = process.env.NODE_ENV === "production";
    const raw = (process.env.PAYMENTS_PROVIDER ?? "").trim().toLowerCase();
    if (!raw || raw === "none") {
      if (!production) return "mock";
      throw new Error("PAYMENTS_PROVIDER is not set. Set PAYMENTS_PROVIDER=stripe with STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.");
    }
    if (raw !== "mock" && raw !== "stripe" && raw !== "paypal") throw new Error(`PAYMENTS_PROVIDER must be "paypal", "stripe" or "mock" (got "${raw}")`);
    if (raw === "mock" && production && process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION !== "true")
      throw new Error("Sandbox (mock) payments are disabled in production. Set PAYMENTS_PROVIDER=stripe with STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.");
    return raw;
  },
  get paypal() {
    const envName = (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase();
    if (envName !== "sandbox" && envName !== "live") throw new Error(`PAYPAL_ENV must be "sandbox" or "live"`);
    return {
      clientId: required("PAYPAL_CLIENT_ID"),
      clientSecret: required("PAYPAL_CLIENT_SECRET"),
      webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
      env: envName as "sandbox" | "live",
    };
  },
  get stripeSecretKey() {
    return required("STRIPE_SECRET_KEY");
  },
  get stripeWebhookSecret() {
    return required("STRIPE_WEBHOOK_SECRET");
  },
  /** Bearer token for /api/cron/* (rent engine). */
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  get storageDir() {
    return process.env.STORAGE_DIR ?? "./storage";
  },
  get sessionDays() {
    return Number(process.env.SESSION_DAYS ?? 14);
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};
