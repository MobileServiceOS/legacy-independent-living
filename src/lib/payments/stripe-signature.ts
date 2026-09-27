/**
 * Stripe webhook signature verification (scheme v1), implemented with
 * node:crypto so it's dependency-free and unit-testable.
 * https://docs.stripe.com/webhooks#verify-manually
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_TOLERANCE_SECONDS = 300;

export function computeStripeSignature(payload: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
}

export function buildStripeSignatureHeader(payload: string, secret: string, timestamp: number): string {
  return `t=${timestamp},v1=${computeStripeSignature(payload, secret, timestamp)}`;
}

export function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; nowSeconds?: number } = {},
): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "missing signature header" };
  if (!secret) return { ok: false, reason: "webhook secret not configured" };
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k === "t" && v) timestamp = Number(v);
    if (k === "v1" && v) signatures.push(v);
  }
  if (timestamp === null || !Number.isFinite(timestamp)) return { ok: false, reason: "missing timestamp" };
  if (signatures.length === 0) return { ok: false, reason: "no v1 signature" };
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS))
    return { ok: false, reason: "timestamp outside tolerance" };
  const expected = Buffer.from(computeStripeSignature(payload, secret, timestamp), "hex");
  const match = signatures.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}
