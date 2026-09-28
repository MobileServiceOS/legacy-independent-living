import type { Metadata } from "next";
import { NotificationList } from "@/components/notification-list";
import { PushSettings } from "@/components/push-controls";
import { TestPushButton } from "@/components/test-push";
import { vapidConfig } from "@/lib/push";
import { Card } from "@/components/ui";
import { requireResidentPage } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { listNotifications } from "@/server/notifications";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireResidentPage();
  const [items, settings] = await Promise.all([listNotifications(user.id), getSettings()]);
  return (
    <div className="space-y-5">
      <h1 className="text-4xl">Notifications</h1>
      <PushSettings vapidKey={vapidConfig()?.publicKey ?? null} />
      <TestPushButton />
      <Card>
        <NotificationList items={items} timeZone={settings.timezone} />
      </Card>
    </div>
  );
}
