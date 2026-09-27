/** Resident clicked "Cancel and return" on PayPal. */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { cancelRedirectPayment } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const paymentId = new URL(req.url).searchParams.get("payment") ?? "";
  const user = await getSessionUser();
  if (user && paymentId) await cancelRedirectPayment(user, paymentId).catch((err) => console.error("[payments] cancel failed", err));
  return NextResponse.redirect(`${env.appUrl}/pay?canceled=1`);
}
