import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { onlinePaymentSchema } from "../../src/lib/validation.ts";
import { ONLINE_METHODS } from "../../src/domain/payments.ts";

describe("onlinePaymentSchema", () => {
  test("accepts every method the domain model calls online (regression: CASH_APP was missing from this enum)", () => {
    for (const method of ONLINE_METHODS) {
      const result = onlinePaymentSchema.safeParse({ amount: "1.00", method });
      assert.equal(result.success, true, `expected ${method} to be a valid online payment method`);
    }
  });

  test("rejects an offline-only method", () => {
    const result = onlinePaymentSchema.safeParse({ amount: "1.00", method: "CASH" });
    assert.equal(result.success, false);
  });
});
