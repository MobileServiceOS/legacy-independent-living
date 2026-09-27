import type { Metadata } from "next";
import Link from "next/link";
import { EmergencyNote } from "@/components/emergency-note";
import { Icon } from "@/components/icons";
import { Card, EmptyState, MaintenanceStatusBadge, PriorityBadge } from "@/components/ui";
import { dateOnlyFromInstant, formatShort } from "@/domain/dates";
import { isOpen, MAINTENANCE_CATEGORY_SHORT, maintenanceRef } from "@/domain/maintenance";
import { requireResidentPage } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { listResidentRequests } from "@/server/maintenance";

export const metadata: Metadata = { title: "Repairs" };
export const dynamic = "force-dynamic";

export default async function MaintenanceListPage() {
  const user = await requireResidentPage();
  const [requests, settings] = await Promise.all([listResidentRequests(user.residentId), getSettings()]);
  const open = requests.filter((r) => isOpen(r.status));
  const closed = requests.filter((r) => !isOpen(r.status));

  const Row = ({ r }: { r: (typeof requests)[number] }) => (
    <li>
      <Link href={`/maintenance/${r.id}`} className="flex min-h-16 items-center justify-between gap-3 py-3 text-ink no-underline hover:bg-paper">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{r.title}</p>
          <p className="text-sm text-muted">
            {maintenanceRef(r.number)} · {MAINTENANCE_CATEGORY_SHORT[r.category]} · {formatShort(dateOnlyFromInstant(r.createdAt, settings.timezone))}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <MaintenanceStatusBadge status={r.status} />
          {r.priority === "URGENT" && isOpen(r.status) ? <PriorityBadge priority="URGENT" /> : null}
        </div>
      </Link>
    </li>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-4xl">Repairs</h1>
      </div>
      <Link href="/maintenance/new" className="btn-primary min-h-14 w-full text-lg" data-testid="report-problem">
        <Icon name="wrench" /> Report a problem
      </Link>
      <EmergencyNote phone={settings.supportPhone} />

      <Card title="Open requests">
        {open.length === 0 ? (
          <EmptyState title="No open requests" icon="check">
            If something in your room or the house needs fixing, tap “Report a problem”.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Card>
      {closed.length ? (
        <Card title="Past requests">
          <ul className="divide-y divide-line">
            {closed.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
