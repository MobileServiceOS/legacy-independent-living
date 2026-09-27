import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Checkbox, Hidden, Input, Select, SubmitButton, Textarea } from "@/components/form";
import { MaintenanceTimeline, PhotoGrid } from "@/components/maintenance-timeline";
import { PhotoInput } from "@/components/photo-input";
import { BackLink, Card, DefinitionList, DemoTag, MaintenanceStatusBadge, PageHeader, PriorityBadge } from "@/components/ui";
import { utcToZonedLocal } from "@/domain/dates";
import {
  MAINTENANCE_CATEGORY_SHORT,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_SHORT,
  MAINTENANCE_STATUS_LABELS,
  maintenanceRef,
  nextMaintenanceStatuses,
} from "@/domain/maintenance";
import { requirePagePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { formatWhen, getMaintenanceForStaff } from "@/server/maintenance";
import { staffMaintenanceUpdateAction } from "@/app/actions/maintenance";

export const metadata: Metadata = { title: "Maintenance request" };
export const dynamic = "force-dynamic";

export default async function StaffMaintenancePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("maintenance:read");
  const { id } = await params;
  const [req, settings] = await Promise.all([getMaintenanceForStaff(id), getSettings()]);
  if (!req) notFound();
  const nextStatuses = nextMaintenanceStatuses(req.status);

  return (
    <>
      <BackLink href="/admin/maintenance">Maintenance</BackLink>
      <PageHeader
        eyebrow={`${maintenanceRef(req.number)} · ${MAINTENANCE_CATEGORY_SHORT[req.category]} · submitted ${formatDateTime(req.createdAt, settings.timezone)}`}
        title={req.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <MaintenanceStatusBadge status={req.status} />
            <PriorityBadge priority={req.priority} />
            {req.resident.isDemo ? <DemoTag /> : null}
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Problem">
            <p className="whitespace-pre-wrap">{req.description}</p>
            {req.photos.length ? (
              <div className="mt-4">
                <PhotoGrid photos={req.photos} />
              </div>
            ) : null}
            <div className="mt-5">
              <DefinitionList
                items={[
                  [
                    "Resident",
                    <Link key="r" href={`/admin/residents/${req.resident.id}`} className="font-bold">
                      {req.resident.firstName} {req.resident.lastName}
                    </Link>,
                  ],
                  ["Phone", <a key="p" href={`tel:${req.resident.phone}`}>{req.resident.phone}</a>],
                  ["Home", req.property ? `${req.property.name}${req.room ? ` · ${req.room.name}` : ""}` : null],
                  ["Location", req.location],
                  ["OK to enter when away", req.permissionToEnter ? "Yes" : "No — arrange a time"],
                  ["Entry notes", req.entryNotes],
                  ["Visit", req.scheduledFor ? formatWhen(req.scheduledFor, settings.timezone) : null],
                  ["Assigned to", req.assignedTo],
                ]}
              />
            </div>
          </Card>
          <Card title="Timeline">
            <MaintenanceTimeline updates={req.updates} timeZone={settings.timezone} viewer="ADMIN" />
          </Card>
        </div>

        <aside className="min-w-0">
          <Card title="Update request">
            {req.status === "CANCELED" ? (
              <p className="text-muted">This request was canceled and is closed.</p>
            ) : (
              <ActionForm action={staffMaintenanceUpdateAction} className="space-y-4" resetOnSuccess resetKey={req.updatedAt.toISOString()}>
                <Hidden name="requestId" value={req.id} />
                <Select
                  name="status"
                  label="Status"
                  defaultValue={req.status}
                  options={[
                    { value: req.status, label: `${MAINTENANCE_STATUS_LABELS[req.status]} (current)` },
                    ...nextStatuses.filter((s) => s !== req.status).map((s) => ({ value: s, label: MAINTENANCE_STATUS_LABELS[s] })),
                  ]}
                />
                <Select name="priority" label="Priority" defaultValue={req.priority} options={MAINTENANCE_PRIORITIES.map((p) => ({ value: p, label: MAINTENANCE_PRIORITY_SHORT[p] }))} />
                <Input
                  name="scheduledFor"
                  type="datetime-local"
                  label="Visit date & time"
                  defaultValue={req.scheduledFor ? utcToZonedLocal(req.scheduledFor, settings.timezone) : undefined}
                  hint="Required when status is Scheduled. The resident sees it."
                />
                <Input name="assignedTo" label="Assigned to" defaultValue={req.assignedTo} placeholder="e.g. Mike (handyman), ABC Plumbing" />
                <Textarea name="body" label="Note" rows={3} hint="Visible to the resident unless marked staff-only." />
                <Checkbox name="internal" label="Staff-only note" hint="Hidden from the resident. Ignored when you also change the status." />
                <PhotoInput max={3} label="Add photos (optional)" hint="e.g. before/after the repair." />
                <SubmitButton>Save update</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
