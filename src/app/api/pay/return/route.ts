/** Return from the processor (Stripe/PayPal): confirm server-side, then show the result page. */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { UserError } from "@/server/errors";
import { completeRedirectPayment } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("payment") ?? "";
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${env.appUrl}/login?next=${encodeURIComponent(`/api/pay/return?payment=${paymentId}`)}`);
  let error = "";
  try {
    if (paymentId) await completeRedirectPayment(user, paymentId);
  } catch (err) {
    error = err instanceof UserError ? err.message : "1";
  }
  return NextResponse.redirect(`${env.appUrl}/pay/return?payment=${encodeURIComponent(paymentId)}${error ? "&confirming=1" : ""}`);
}
