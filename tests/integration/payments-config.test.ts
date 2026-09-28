/**
 * Online-payments configuration: a deploy without processor credentials must
 * keep running ("not set up" state) instead of throwing on every page.
 */
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { paymentsStatus, getPaymentProvider, PaymentsNotConfiguredError, setPaymentProviderForTests } from "../../src/lib/payments";

const e = process.env as Record<string, string | undefined>;
const KEYS = ["NODE_ENV", "PAYMENTS_PROVIDER", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENV", "ALLOW_MOCK_PAYMENTS_IN_PRODUCTION"];
const saved = Object.fromEntries(KEYS.map((k) => [k, e[k]]));

function setEnv(values: Record<string, string | undefined>) {
  for (const k of KEYS) delete e[k];
  Object.assign(e, values);
  setPaymentProviderForTests(null);
}

describe("payments configuration", () => {
  beforeEach(() => setEnv({}));
  after(() => {
    for (const k of KEYS) if (saved[k] === undefined) delete e[k];
    else e[k] = saved[k];
    setPaymentProviderForTests(null);
  });

  it("defaults to the sandbox outside production", () => {
    setEnv({ NODE_ENV: "development" });
    const s = paymentsStatus();
    assert.ok(s.configured);
    assert.equal(s.provider.name, "MOCK");
  });

  it("production with nothing set → not configured (no throw), with a setup hint", () => {
    setEnv({ NODE_ENV: "production" });
    const s = paymentsStatus();
    assert.equal(s.configured, false);
    assert.match(!s.configured ? s.reason : "", /PAYMENTS_PROVIDER=paypal/);
    assert.throws(() => getPaymentProvider(), PaymentsNotConfiguredError);
  });

  it("production refuses the sandbox provider unless explicitly allowed", () => {
    setEnv({ NODE_ENV: "production", PAYMENTS_PROVIDER: "mock" });
    assert.equal(paymentsStatus().configured, false);
    setEnv({ NODE_ENV: "production", PAYMENTS_PROVIDER: "mock", ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: "true" });
    assert.equal(paymentsStatus().configured, true);
  });

  it("paypal without credentials → not configured, naming the missing variable", () => {
    setEnv({ NODE_ENV: "production", PAYMENTS_PROVIDER: "paypal" });
    const s = paymentsStatus();
    assert.equal(s.configured, false);
    assert.match(!s.configured ? s.reason : "", /PAYPAL_CLIENT_ID/);
  });

  it("paypal with credentials → configured PayPal sandbox", () => {
    setEnv({ NODE_ENV: "production", PAYMENTS_PROVIDER: "PayPal", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_ENV: "sandbox" });
    const s = paymentsStatus();
    assert.ok(s.configured);
    assert.equal(s.provider.name, "PAYPAL");
    assert.equal(s.provider.isSandbox, true);
  });

  it("an unknown provider name is reported, not thrown", () => {
    setEnv({ NODE_ENV: "production", PAYMENTS_PROVIDER: "venmo" });
    const s = paymentsStatus();
    assert.equal(s.configured, false);
    assert.match(!s.configured ? s.reason : "", /venmo/);
  });
});
