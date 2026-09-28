/**
 * Stripe webhook. Verifies the signature against the RAW body, normalizes the
 * event, and applies it idempotently. Returns 2xx for handled/ignored events so
 * Stripe stops retrying; 400 for bad signatures; 500 to request a retry.
 */
import { NextResponse } from "next/server";
import { paymentsStatus } from "@/lib/payments";
import { PaymentProviderError } from "@/lib/payments/provider";
import { NotFoundError } from "@/server/errors";
import { applyProviderEvent } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const status = paymentsStatus();
  // 503 → the processor retries later, once payments are configured.
  if (!status.configured) return NextResponse.json({ error: "online payments are not set up" }, { status: 503 });
  const provider = status.provider;
  if (provider.name !== "STRIPE") return NextResponse.json({ error: "Stripe is not the active provider" }, { status: 404 });
  const raw = await req.text();
  let event;
  try {
    event = await provider.parseWebhook(raw, req.headers);
  } catch (err) {
    const msg = err instanceof PaymentProviderError ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  try {
    const result = await applyProviderEvent("STRIPE", event);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    if (err instanceof NotFoundError) {
      // Not one of ours (e.g. another integration on the same Stripe account).
      return NextResponse.json({ received: true, ignored: "unknown payment" });
    }
    console.error("[stripe-webhook] failed", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
