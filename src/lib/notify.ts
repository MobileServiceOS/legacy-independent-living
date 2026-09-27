/**
 * Notification architecture.
 *   notify() writes an in-app Notification + one NotificationDelivery row per
 *   channel. IN_APP is delivered immediately (SENT). EMAIL/SMS/PUSH rows are
 *   created as PENDING only when a channel adapter is configured, so a future
 *   worker (or adapter below) can deliver them without changing any callers.
 */
import type { NotificationChannel, NotificationType } from "@prisma/client";
import { prisma, type Db } from "./db";
import { pushConfigured, sendPushToUser } from "./push";

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  /** Same key → notification is created at most once (rent reminders, etc). */
  dedupeKey?: string | null;
}

export interface ChannelAdapter {
  channel: Exclude<NotificationChannel, "IN_APP">;
  isConfigured(): boolean;
  /** Return false when there was nothing to deliver to (e.g. no devices) → SKIPPED. */
  send(n: { userId: string; to: string; title: string; body: string; link?: string | null; type: NotificationType }): Promise<boolean | void>;
}

/** Push: Web Push (installed PWA / browsers) + APNs (iOS app). */
const pushAdapter: ChannelAdapter = {
  channel: "PUSH",
  isConfigured: pushConfigured,
  async send(n) {
    const r = await sendPushToUser(n.userId, { title: n.title, body: n.body, link: n.link, tag: n.type.toLowerCase() });
    if (r.devices === 0) return false;
    if (r.sent === 0) throw new Error(`push failed on all ${r.devices} device(s)`);
    return true;
  },
};

/** Register adapters here (e.g. Resend/Postmark for EMAIL, Twilio for SMS). */
export const channelAdapters: ChannelAdapter[] = [pushAdapter];

export async function notify(db: Db, input: NotifyInput): Promise<boolean> {
  if (input.dedupeKey) {
    const exists = await db.notification.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } });
    if (exists) return false;
  }
  const configured = channelAdapters.filter((a) => a.isConfigured()).map((a) => a.channel);
  await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      dedupeKey: input.dedupeKey ?? null,
      deliveries: {
        create: [
          { channel: "IN_APP", status: "SENT", attemptedAt: new Date() },
          ...configured.map((channel) => ({ channel, status: "PENDING" as const })),
        ],
      },
    },
  });
  if (configured.length) scheduleDelivery();
  return true;
}

// Deliveries are written inside the caller's transaction, so send shortly after
// it commits. Two passes cover slow transactions; the cron sweep catches the rest.
const g = globalThis as unknown as { __lilDeliveryTimers?: Set<ReturnType<typeof setTimeout>> };
g.__lilDeliveryTimers ??= new Set();

export function scheduleDelivery(): void {
  if (process.env.NOTIFY_SYNC_DELIVERY === "off" || g.__lilDeliveryTimers!.size >= 2) return;
  for (const delay of [400, 4000]) {
    const t = setTimeout(() => {
      g.__lilDeliveryTimers!.delete(t);
      deliverPendingNotifications().catch((err) => console.error("[notify] delivery pass failed", err));
    }, delay);
    t.unref?.();
    g.__lilDeliveryTimers!.add(t);
  }
}

/** Notify every active admin (e.g. new application, failed payment). */
export async function notifyAdmins(db: Db, input: Omit<NotifyInput, "userId">): Promise<void> {
  const admins = await db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
  for (const a of admins) {
    await notify(db, { ...input, userId: a.id, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${a.id}` : null });
  }
}

/** Deliver pending external-channel notifications. Safe to run concurrently and from a cron. */
export async function deliverPendingNotifications(limit = 200): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const pending = await prisma.notificationDelivery.findMany({
    where: { status: "PENDING", channel: { not: "IN_APP" }, attemptedAt: null, createdAt: { gt: new Date(Date.now() - 3 * 86_400_000) } },
    include: { notification: { include: { user: { select: { id: true, email: true, status: true } } } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const d of pending) {
    // Claim the row so concurrent passes never double-send.
    const claimed = await prisma.notificationDelivery.updateMany({ where: { id: d.id, attemptedAt: null }, data: { attemptedAt: new Date() } });
    if (claimed.count !== 1) continue;
    const adapter = channelAdapters.find((a) => a.channel === d.channel && a.isConfigured());
    const user = d.notification.user;
    if (!adapter || user.status === "DISABLED") {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED" } });
      skipped++;
      continue;
    }
    try {
      const delivered = await adapter.send({
        userId: user.id,
        to: user.email,
        title: d.notification.title,
        body: d.notification.body,
        link: d.notification.link,
        type: d.notification.type,
      });
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: delivered === false ? "SKIPPED" : "SENT" } });
      if (delivered === false) skipped++;
      else sent++;
    } catch (err) {
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: "FAILED", error: String((err as Error).message).slice(0, 500) },
      });
      failed++;
    }
  }
  return { sent, failed, skipped };
}
