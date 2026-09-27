import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, Checkbox, Disclosure, Hidden, Input, SubmitButton, Textarea } from "@/components/form";
import { MaintenanceTimeline, PhotoGrid } from "@/components/maintenance-timeline";
import { PhotoInput } from "@/components/photo-input";
import { BackLink, Card, DefinitionList, MaintenanceStatusBadge, Notice, PriorityBadge } from "@/components/ui";
import {
  MAINTENANCE_CATEGORY_SHORT,
  MAINTENANCE_STATUS_HELP,
  maintenanceRef,
  REOPEN_WINDOW_DAYS,
  residentCanCancel,
} from "@/domain/maintenance";
import { requireResidentPage } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { formatWhen, getResidentRequest } from "@/server/maintenance";
import { cancelMaintenanceAction, maintenanceCommentAction, reopenMaintenanceAction } from "@/app/actions/maintenance";

export const metadata: Metadata = { title: "Repair request" };
export const dynamic = "force-dynamic";

export default async function MaintenanceDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const user = await requireResidentPage();
  const { id } = await params;
  const { submitted } = await searchParams;
  const [req, settings] = await Promise.all([getResidentRequest(user.residentId, id), getSettings()]);
  if (!req) notFound();
  const canReopen = req.status === "COMPLETED" && req.completedAt && Date.now() - req.completedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;

  return (
    <div className="space-y-5">
      <BackLink href="/maintenance">Repairs</BackLink>
      {submitted ? (
        <Notice tone="ok" title="Request sent">
          The office has been notified. You’ll get an alert here when there’s an update.
        </Notice>
      ) : null}
      <div>
        <p className="text-sm font-bold text-muted">{maintenanceRef(req.number)}</p>
        <h1 className="text-4xl" data-testid="request-title">
          {req.title}
        </h1>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <MaintenanceStatusBadge status={req.status} size="lg" />
          {req.priority !== "NORMAL" ? <PriorityBadge priority={req.priority} /> : null}
        </div>
        <p className="mt-2 text-muted">{MAINTENANCE_STATUS_HELP[req.status]}</p>
        {req.scheduledFor && (req.status === "SCHEDULED" || req.status === "IN_PROGRESS") ? (
          <p className="mt-3 rounded-xl bg-warn-bg px-4 py-3 text-lg font-bold text-warn" data-testid="scheduled-for">
            Visit: {formatWhen(req.scheduledFor, settings.timezone)}
            {req.assignedTo ? <span className="block text-sm font-semibold">With {req.assignedTo}</span> : null}
          </p>
        ) : null}
      </Card>

      <Card title="Details">
        <DefinitionList
          items={[
            ["Type", MAINTENANCE_CATEGORY_SHORT[req.category]],
            ["Where", req.location ?? (req.room ? `${req.property?.name} · ${req.room.name}` : null)],
            ["OK to enter", req.permissionToEnter ? "Yes" : "No — please arrange a time"],
            ["Entry notes", req.entryNotes],
          ]}
        />
        <p className="mt-4 whitespace-pre-wrap rounded-lg bg-paper-2 p-3">{req.description}</p>
        {req.photos.length ? (
          <div className="mt-4">
            <PhotoGrid photos={req.photos} />
          </div>
        ) : null}
      </Card>

      <Card title="Updates">
        <MaintenanceTimeline updates={req.updates} timeZone={settings.timezone} viewer="RESIDENT" />
        {req.status !== "CANCELED" && req.status !== "COMPLETED" ? (
          <ActionForm action={maintenanceCommentAction} className="mt-5 space-y-3" resetOnSuccess>
            <Hidden name="requestId" value={req.id} />
            <Textarea name="body" label="Send a message to the office" rows={3} required />
            <PhotoInput max={3} label="Add photos (optional)" hint="Up to 3 photos." />
            <SubmitButton pendingText="Sending…">Send message</SubmitButton>
          </ActionForm>
        ) : null}
      </Card>

      {canReopen ? (
        <Disclosure summary="The problem came back">
          <ActionForm action={reopenMaintenanceAction} className="space-y-3">
            <Hidden name="requestId" value={req.id} />
            <Textarea name="body" label="What's happening now?" rows={3} required />
            <SubmitButton variant="secondary">Reopen request</SubmitButton>
          </ActionForm>
        </Disclosure>
      ) : null}

      {residentCanCancel(req.status) ? (
        <Disclosure summary={<span className="text-muted">Cancel this request</span>}>
          <ActionForm action={cancelMaintenanceAction} className="space-y-3">
            <Hidden name="requestId" value={req.id} />
            <Input name="reason" label="Reason (optional)" placeholder="e.g. It fixed itself" />
            <Checkbox name="confirm" label="Yes, cancel this request" />
            <SubmitButton variant="danger" small>
              Cancel request
            </SubmitButton>
          </ActionForm>
        </Disclosure>
      ) : null}
    </div>
  );
}
