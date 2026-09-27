import Link from "next/link";
import type { Notification } from "@prisma/client";
import { markNotificationsReadAction } from "@/app/actions/resident";
import { EmptyState } from "./ui";
import { formatDateTime } from "@/lib/format";

export function NotificationList({ items, timeZone }: { items: Notification[]; timeZone: string }) {
  if (items.length === 0) return <EmptyState title="No notifications" icon="bell">We’ll let you know about rent, payments and announcements here.</EmptyState>;
  const unread = items.some((n) => !n.readAt);
  return (
    <div>
      {unread ? (
        <form action={markNotificationsReadAction} className="mb-3 flex justify-end">
          <button type="submit" className="btn-secondary btn-sm">
            Mark all as read
          </button>
        </form>
      ) : null}
      <ul className="divide-y divide-line">
        {items.map((n) => (
          <li key={n.id} className={`flex gap-3 py-3 ${n.readAt ? "" : ""}`}>
            <span aria-hidden className={`mt-2 size-2.5 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-bad"}`} />
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                {n.title}
                {!n.readAt ? <span className="sr-only"> (unread)</span> : null}
              </p>
              <p className="text-muted">{n.body}</p>
              <p className="mt-1 text-xs text-muted">{formatDateTime(n.createdAt, timeZone)}</p>
              <div className="mt-1 flex flex-wrap gap-3">
                {n.link ? (
                  <Link href={n.link} className="text-sm font-bold">
                    Open
                  </Link>
                ) : null}
                {!n.readAt ? (
                  <form action={markNotificationsReadAction}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <button type="submit" className="text-sm font-bold text-muted underline-offset-4 hover:underline">
                      Mark read
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
