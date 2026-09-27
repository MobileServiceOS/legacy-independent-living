/**
 * Daily rent job. Call from any scheduler (Vercel Cron, GitHub Actions, cron + curl):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://portal.example.com/api/cron/rent
 */
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { deliverPendingNotifications } from "@/lib/notify";
import { safeEqual } from "@/lib/security/crypto";
import { runRentEngine } from "@/server/rent-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const secret = env.cronSecret;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rent = await runRentEngine();
  const delivery = await deliverPendingNotifications();
  return NextResponse.json({ ok: true, rent, delivery });
}

export const POST = handle;
export const GET = handle; // Vercel Cron issues GET requests
