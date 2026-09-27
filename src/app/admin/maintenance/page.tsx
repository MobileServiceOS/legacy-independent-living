import type { Metadata } from "next";
import Link from "next/link";
import { Card, DemoTag, EmptyState, MaintenanceStatusBadge, PageHeader, PriorityBadge, Stat, TableWrap } from "@/components/ui";
import {
  MAINTENANCE_CATEGORY_SHORT,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_SHORT,
  MAINTENANCE_STATUSES,
  MAINTENANCE_STATUS_LABELS,
  maintenanceRef,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "@/domain/maintenance";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { formatWhen, listMaintenance, maintenanceCounts } from "@/server/maintenance";

export const metadata: Metadata = { title: "Maintenance" };
export const dynamic = "force-dynamic";

type SP = { status?: string; propertyId?: string; priority?: string; q?: string };

export default async function MaintenanceQueuePage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("maintenance:read");
  const sp = await searchParams;
  const status = sp.status === "ALL" || MAINTENANCE_STATUSES.includes(sp.status as MaintenanceStatus) ? (sp.status as MaintenanceStatus | "ALL") : "OPEN";
  const priority = MAINTENANCE_PRIORITIES.includes(sp.priority as MaintenancePriority) ? (sp.priority as MaintenancePriority) : undefined;
  const [rows, counts, properties, settings] = await Promise.all([
    listMaintenance({ status, priority, propertyId: sp.propertyId || undefined, q: sp.q?.slice(0, 100) }),
    maintenanceCounts(),
    prisma.property.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader title="Maintenance" description="Repair requests from residents — urgent and oldest first." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open requests" value={counts.open} />
        <Stat label="Urgent (open)" value={counts.urgent} tone={counts.urgent ? "bad" : undefined} />
        <Stat label="New — not yet seen" value={counts.submitted} tone={counts.submitted ? "warn" : undefined} />
        <Stat label="Scheduled" value={counts.byStatus.SCHEDULED ?? 0} />
      </div>

      <Card className="mb-5">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.5fr_auto]" role="search">
          <div>
            <label className="label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status} className="input">
              <option value="OPEN">All open</option>
              {MAINTENANCE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {MAINTENANCE_STATUS_LABELS[s]}
                </option>
              ))}
              <option value="ALL">Everything</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priority">
              Priority
            </label>
            <select id="priority" name="priority" defaultValue={priority ?? ""} className="input">
              <option value="">Any</option>
              {MAINTENANCE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {MAINTENANCE_PRIORITY_SHORT[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="propertyId">
              Property
            </label>
            <select id="propertyId" name="propertyId" defaultValue={sp.propertyId ?? ""} className="input">
              <option value="">All</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="q">
              Search
            </label>
            <input id="q" name="q" defaultValue={sp.q} placeholder="Resident, issue or MR-number" className="input" />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn-primary">
              Filter
            </button>
            <Link href="/admin/maintenance" className="btn-secondary">
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No requests match" icon="wrench">
            Residents submit requests from the Repairs tab in their portal.
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="table min-w-[60rem]">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Resident</th>
                  <th>Where</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/maintenance/${r.id}`} className="font-bold">
                        {r.title}
                      </Link>
                      <span className="block text-xs text-muted">
                        {maintenanceRef(r.number)}
                        {r._count.photos ? ` · ${r._count.photos} photo${r._count.photos > 1 ? "s" : ""}` : ""}
                      </span>
                    </td>
                    <td>
                      <Link href={`/admin/residents/${r.resident.id}`}>
                        {r.resident.firstName} {r.resident.lastName}
                      </Link>
                      {r.resident.isDemo ? <DemoTag /> : null}
                    </td>
                    <td className="text-sm">
                      {r.property ? `${r.property.name}${r.room ? ` · ${r.room.name}` : ""}` : "—"}
                      {r.location ? <span className="block text-muted">{r.location}</span> : null}
                    </td>
                    <td className="text-sm">{MAINTENANCE_CATEGORY_SHORT[r.category]}</td>
                    <td>
                      <PriorityBadge priority={r.priority} />
                    </td>
                    <td>
                      <MaintenanceStatusBadge status={r.status} />
                      {r.status === "SCHEDULED" && r.scheduledFor ? <span className="mt-1 block text-xs text-muted">{formatWhen(r.scheduledFor, settings.timezone)}</span> : null}
                    </td>
                    <td className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt, settings.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
