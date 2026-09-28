import { audit, AUDIT_ACTIONS, type Actor } from "../lib/audit";
import { prisma } from "../lib/db";
import { deliverPendingNotifications, notify } from "../lib/notify";
import { activeDeviceCount, pushConfigured } from "../lib/push";
import { UserError } from "./errors";

export async function listNotifications(userId: string, take = 50) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, notificationId?: string) {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(notificationId ? { id: notificationId } : {}) },
    data: { readAt: new Date() },
  });
}

/** Administrative announcement → in-app notification to every active resident (optionally one property). */
export async function sendAnnouncement(actor: Actor, input: { title: string; body: string; propertyId: string | null }) {
  return prisma.$transaction(async (tx) => {
    const announcement = await tx.announcement.create({ data: { ...input, createdById: actor.id } });
    const residents = await tx.resident.findMany({
      where: {
        status: "ACTIVE",
        userId: { not: null },
        ...(input.propertyId ? { assignments: { some: { endDate: null, room: { propertyId: input.propertyId } } } } : {}),
      },
      select: { userId: true },
    });
    for (const r of residents) {
      await notify(tx, {
        userId: r.userId!,
        type: "ANNOUNCEMENT",
        title: input.title,
        body: input.body,
        link: "/notifications",
        dedupeKey: `announcement:${announcement.id}:${r.userId}`,
      });
    }
    await audit(tx, actor, AUDIT_ACTIONS.announcementSent, "announcement", announcement.id, {
      recipients: residents.length,
      propertyId: input.propertyId,
    });
    return { recipients: residents.length };
  });
}

/**
 * "Send a test notification" — pushes to the signed-in user's own devices and
 * reports what actually happened (sent / failed + reason), so anyone can check
 * that alerts reach their phone without involving residents.
 */
export async function sendTestNotification(user: { id: string }, link: string): Promise<{ devices: number }> {
  if (!pushConfigured()) throw new UserError("Push notifications aren’t set up on the server yet (VAPID / APNs keys).");
  const devices = await activeDeviceCount(user.id);
  if (devices === 0) throw new UserError("Turn on notifications on this device first, then try again.");
  await notify(prisma, {
    userId: user.id,
    type: "ACCOUNT",
    title: "Test notification",
    body: "Notifications are working on this device. Tap to open the app.",
    link,
  });
  await deliverPendingNotifications();
  const delivery = await prisma.notificationDelivery.findFirst({
    where: { channel: "PUSH", notification: { userId: user.id, title: "Test notification" } },
    orderBy: { createdAt: "desc" },
  });
  if (delivery?.status === "FAILED") throw new UserError(`Couldn’t deliver the test: ${delivery.error ?? "unknown error"}`);
  if (delivery?.status === "SKIPPED") throw new UserError("No active devices — turn notifications on again on this device.");
  return { devices };
}
