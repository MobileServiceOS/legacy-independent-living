/**
 * Push/email delivery sweep — backstop for the instant send. Schedule every 5 minutes:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/notify
 */
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { deliverPendingNotifications } from "@/lib/notify";
import { safeEqual } from "@/lib/security/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const secret = env.cronSecret;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, delivery: await deliverPendingNotifications() });
}

export const POST = handle;
export const GET = handle;
