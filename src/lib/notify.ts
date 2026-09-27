/**
 * Notification architecture.
 *   notify() writes an in-app Notification + one NotificationDelivery row per
 *   channel. IN_APP is delivered immediately (SENT). EMAIL/SMS/PUSH rows are
 *   created as PENDING only when a channel adapter is configured, so a future
 *   worker (or adapter below) can deliver them without changing any callers.
 */
import type { NotificationChannel, NotificationType } from "@prisma/client";
import { prisma, type Db } from "./db";

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
  send(n: { to: string; title: string; body: string; link?: string | null }): Promise<void>;
}

/** Register real adapters here (e.g. Resend/Postmark for EMAIL, Twilio for SMS). */
export const channelAdapters: ChannelAdapter[] = [];

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
  return true;
}

/** Notify every active admin (e.g. new application, failed payment). */
export async function notifyAdmins(db: Db, input: Omit<NotifyInput, "userId">): Promise<void> {
  const admins = await db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
  for (const a of admins) {
    await notify(db, { ...input, userId: a.id, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${a.id}` : null });
  }
}

/** Deliver pending external-channel notifications. Safe to run from a cron. */
export async function deliverPendingNotifications(limit = 100): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const pending = await prisma.notificationDelivery.findMany({
    where: { status: "PENDING", channel: { not: "IN_APP" } },
    include: { notification: { include: { user: { select: { email: true } } } } },
    take: limit,
  });
  for (const d of pending) {
    const adapter = channelAdapters.find((a) => a.channel === d.channel && a.isConfigured());
    if (!adapter) {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", attemptedAt: new Date() } });
      continue;
    }
    try {
      await adapter.send({ to: d.notification.user.email, title: d.notification.title, body: d.notification.body, link: d.notification.link });
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SENT", attemptedAt: new Date() } });
      sent++;
    } catch (err) {
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: "FAILED", attemptedAt: new Date(), error: String((err as Error).message).slice(0, 500) },
      });
      failed++;
    }
  }
  return { sent, failed };
}
