import { audit, AUDIT_ACTIONS, type Actor } from "../lib/audit";
import { prisma } from "../lib/db";
import { notify } from "../lib/notify";

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
