import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Hidden, Select, SubmitButton, Textarea } from "@/components/form";
import { PlacementForm } from "@/components/placement-form";
import { ApplicationStatusBadge, BackLink, Card, DefinitionList, DemoTag, Notice, PageHeader } from "@/components/ui";
import { APPLICATION_STATUS_LABELS, nextApplicationStatuses } from "@/domain/applications";
import { dateOnlyFromDbDate, formatLong } from "@/domain/dates";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { businessToday, getSettings } from "@/lib/settings";
import { assignableRooms } from "@/server/rooms-query";
import { setApplicationStatusAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Application" };
export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("applications:read");
  const { id } = await params;
  const [app, settings] = await Promise.all([prisma.application.findUnique({ where: { id }, include: { resident: { select: { id: true } } } }), getSettings()]);
  if (!app) notFound();
  const today = businessToday(settings);
  const options = nextApplicationStatuses(app.status).filter((s) => s !== "CONVERTED");
  const rooms = app.status === "APPROVED" ? await assignableRooms() : [];
  const desired = app.desiredMoveInDate ? dateOnlyFromDbDate(app.desiredMoveInDate) : null;

  return (
    <>
      <BackLink href={`/admin/applications?status=${app.status}`}>Applications</BackLink>
      <PageHeader
        eyebrow={`Received ${formatDateTime(app.createdAt, settings.timezone)}`}
        title={`${app.firstName} ${app.lastName}`}
        description={
          <span className="flex items-center gap-2">
            <ApplicationStatusBadge status={app.status} />
            {app.isDemo ? <DemoTag /> : null}
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <div className="space-y-6">
          <Card title="Application">
            <DefinitionList
              items={[
                ["Phone", <a key="p" href={`tel:${app.phone}`}>{app.phone}</a>],
                ["Email", <a key="e" href={`mailto:${app.email}`}>{app.email}</a>],
                ["Preferred contact", app.preferredContact],
                ["Desired move-in", desired ? formatLong(desired) : null],
                ["Housing situation", app.housingSituation],
                ["Veteran", app.isVeteran === null ? "Prefer not to say" : app.isVeteran ? "Yes" : "No"],
                ["Heard about us", app.referralSource],
                ["Emergency contact", app.emergencyContactName ? `${app.emergencyContactName}${app.emergencyContactPhone ? ` · ${app.emergencyContactPhone}` : ""}` : null],
              ]}
            />
            {app.message ? (
              <div className="mt-5">
                <p className="text-xs font-extrabold uppercase tracking-wider text-muted">Message</p>
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-paper-2 p-3">{app.message}</p>
              </div>
            ) : null}
          </Card>

          {app.status === "APPROVED" ? (
            <Card title="Convert to resident">
              <PlacementForm
                rooms={rooms}
                applicationId={app.id}
                today={today}
                defaults={{
                  firstName: app.firstName,
                  lastName: app.lastName,
                  email: app.email,
                  phone: app.phone,
                  emergencyContactName: app.emergencyContactName,
                  emergencyContactPhone: app.emergencyContactPhone,
                  moveInDate: desired && desired >= today ? desired : today,
                }}
              />
            </Card>
          ) : null}
          {app.status === "CONVERTED" && app.resident ? (
            <Notice tone="ok" title="This applicant is now a resident">
              <Link href={`/admin/residents/${app.resident.id}`} className="font-bold">
                Open resident profile →
              </Link>
            </Notice>
          ) : null}
        </div>

        <aside>
          <Card title="Review">
            {app.status === "CONVERTED" ? (
              <p className="text-muted">Converted applications are closed.</p>
            ) : (
              <ActionForm action={setApplicationStatusAction} className="space-y-4">
                <Hidden name="applicationId" value={app.id} />
                <Select
                  name="status"
                  label="Status"
                  defaultValue={app.status}
                  options={[{ value: app.status, label: `${APPLICATION_STATUS_LABELS[app.status]} (current)` }, ...options.map((s) => ({ value: s, label: APPLICATION_STATUS_LABELS[s] }))]}
                />
                <Textarea name="reviewNotes" label="Review notes (staff only)" defaultValue={app.reviewNotes} rows={5} />
                <SubmitButton>Save review</SubmitButton>
                {app.status !== "APPROVED" ? <p className="text-sm text-muted">Approve the application to convert them into a resident.</p> : null}
              </ActionForm>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
