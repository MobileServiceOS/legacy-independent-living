/**
 * Register / unregister this device for push.
 *   POST   { kind: "WEB", subscription: PushSubscriptionJSON }   (browser / installed PWA)
 *   POST   { kind: "APNS", token: "<hex device token>" }           (iOS app)
 *   DELETE { endpoint } | { token }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { registerDevice, unregisterDevice } from "@/lib/push";
import { sameOrigin } from "@/lib/security/origin";
import { limiters } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const b64u = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(200);
const register = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("WEB"),
    subscription: z.object({ endpoint: z.string().url().startsWith("https://").max(1000), keys: z.object({ p256dh: b64u, auth: b64u }) }),
    label: z.string().max(80).optional(),
  }),
  z.object({ kind: z.literal("APNS"), token: z.string().regex(/^[0-9a-fA-F]{64,200}$/), label: z.string().max(80).optional() }),
]);
const unregister = z.union([z.object({ endpoint: z.string().max(1000) }), z.object({ token: z.string().max(200) })]);

async function guard(req: Request) {
  if (!sameOrigin(req)) return { error: NextResponse.json({ error: "bad origin" }, { status: 403 }) } as const;
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "sign in required" }, { status: 401 }) } as const;
  if (!limiters.push.hit(user.id).allowed) return { error: NextResponse.json({ error: "too many requests" }, { status: 429 }) } as const;
  return { user } as const;
}

export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const parsed = register.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  const d = parsed.data;
  const device =
    d.kind === "WEB"
      ? await registerDevice(g.user.id, { kind: "WEB", endpoint: d.subscription.endpoint, p256dh: d.subscription.keys.p256dh, auth: d.subscription.keys.auth, label: d.label })
      : await registerDevice(g.user.id, { kind: "APNS", token: d.token, label: d.label });
  return NextResponse.json({ ok: true, id: device.id });
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const parsed = unregister.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const count = await unregisterDevice(g.user.id, parsed.data);
  return NextResponse.json({ ok: true, count });
}
