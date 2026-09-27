import type { Metadata } from "next";
import { ActionForm, Input, Select, SubmitButton, Textarea } from "@/components/form";
import { NotificationList } from "@/components/notification-list";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { listNotifications } from "@/server/notifications";
import { sendAnnouncementAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const user = await requirePagePermission("admin:access");
  const [items, properties, settings] = await Promise.all([
    listNotifications(user.id),
    prisma.property.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(),
  ]);
  return (
    <>
      <PageHeader title="Notifications" />
      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <Card title="Your inbox">
          <NotificationList items={items} timeZone={settings.timezone} />
        </Card>
        <Card title="Send an announcement">
          <ActionForm action={sendAnnouncementAction} className="space-y-4" resetOnSuccess>
            <Select name="propertyId" label="Send to" placeholder="All active residents" options={properties.map((p) => ({ value: p.id, label: `Residents of ${p.name}` }))} />
            <Input name="title" label="Title" placeholder="Water shut-off Tuesday 9–11am" required />
            <Textarea name="body" label="Message" rows={5} required />
            <p className="text-sm text-muted">Delivered in the app today. Email/SMS delivery can be switched on later without changing this screen.</p>
            <SubmitButton>Send announcement</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
