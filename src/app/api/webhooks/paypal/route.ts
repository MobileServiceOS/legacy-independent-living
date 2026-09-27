/**
 * PayPal webhook (backstop for the return-URL capture). Verified with PayPal's
 * verify-webhook-signature API; applied idempotently by event id.
 */
import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payments";
import { PaymentProviderError } from "@/lib/payments/provider";
import { NotFoundError } from "@/server/errors";
import { applyProviderEvent } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const provider = getPaymentProvider();
  if (provider.name !== "PAYPAL") return NextResponse.json({ error: "PayPal is not the active provider" }, { status: 404 });
  const raw = await req.text();
  let event;
  try {
    event = await provider.parseWebhook(raw, req.headers);
  } catch (err) {
    const msg = err instanceof PaymentProviderError ? err.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  try {
    const result = await applyProviderEvent("PAYPAL", event);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ received: true, ignored: "unknown payment" });
    console.error("[paypal-webhook] failed", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
