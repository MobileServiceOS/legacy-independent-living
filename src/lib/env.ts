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
  /** "mock" (default, sandbox), "paypal", or "stripe". */
  get paymentsProvider(): "mock" | "paypal" | "stripe" {
    const v = (process.env.PAYMENTS_PROVIDER ?? "mock").toLowerCase();
    if (v !== "mock" && v !== "stripe" && v !== "paypal") throw new Error(`PAYMENTS_PROVIDER must be "mock", "paypal" or "stripe"`);
    if (v === "mock" && process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION !== "true")
      throw new Error("Mock payments are disabled in production. Set PAYMENTS_PROVIDER=stripe.");
    return v;
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
