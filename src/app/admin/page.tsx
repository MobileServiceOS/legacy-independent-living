import type { Metadata } from "next";
import Link from "next/link";
import { Card, DemoTag, EmptyState, Money, PageHeader, RentStatusBadge, Stat, TableWrap } from "@/components/ui";
import { formatMonth, formatShort } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { PAYMENT_METHOD_LABELS } from "@/domain/payments";
import { requirePagePermission } from "@/lib/auth/session";
import { paymentDate } from "@/lib/format";
import { businessToday, getSettings } from "@/lib/settings";
import { adminDashboard } from "@/server/queries";
import { maintenanceCounts } from "@/server/maintenance";
import { ensureRentEngineCurrent } from "@/server/rent-engine";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requirePagePermission("admin:access");
  await ensureRentEngineCurrent();
  const settings = await getSettings();
  const today = businessToday(settings);
  const [d, repairs] = await Promise.all([adminDashboard(today), maintenanceCounts()]);
  const { occupancy: o, collection: c } = d;

  return (
    <>
      <PageHeader
        eyebrow={formatShort(today)}
        title="Dashboard"
        actions={
          <>
            <Link href="/admin/residents/new" className="btn-secondary btn-sm">
              Add resident
            </Link>
            <Link href="/admin/payments?record=1" className="btn-primary btn-sm">
              Record payment
            </Link>
          </>
        }
      />

      <section aria-label="Occupancy" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total residents" value={d.totalResidents} />
        <Stat label="Occupied rooms" value={o.occupied} sub={`of ${o.totalRooms} rooms`} />
        <Stat label="Available rooms" value={o.available} sub={o.reserved || o.maintenance ? `${o.reserved} reserved · ${o.maintenance} maintenance` : undefined} tone={o.available > 0 ? "ok" : undefined} />
        <Stat label="Occupancy rate" value={`${o.occupancyRate}%`} />
      </section>

      <section aria-label={`Rent for ${formatMonth(d.month)}`} className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Rent due · ${formatMonth(d.month)}`} value={formatCents(c.expectedCents)} />
        <Stat label="Rent collected" value={formatCents(c.collectedCents)} sub={`${c.collectionRate}% collected`} tone="ok" />
        <Stat label="Outstanding rent" value={formatCents(c.outstandingCents)} tone={c.outstandingCents > 0 ? "warn" : undefined} />
        <Stat label="Overdue rent" value={formatCents(c.overdueCents)} sub="All months, past due date" tone={c.overdueCents > 0 ? "bad" : undefined} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card title="Residents with rent due" action={<Link href="/admin/residents" className="text-sm font-bold">All residents</Link>}>
          {d.rentDue.length === 0 ? (
            <EmptyState title="No active residents yet">Convert an approved application or add a resident to get started.</EmptyState>
          ) : (
            <TableWrap>
              <table className="table min-w-[44rem]">
                <thead>
                  <tr>
                    <th>Resident</th>
                    <th>Property</th>
                    <th>Room</th>
                    <th className="text-right">Amount</th>
                    <th>Due date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rentDue.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/admin/residents/${r.id}`} className="font-bold">
                          {r.name}
                        </Link>
                        {r.isDemo ? <DemoTag /> : null}
                      </td>
                      <td>{r.propertyName ?? "—"}</td>
                      <td>{r.roomName ?? "—"}</td>
                      <td className="text-right font-semibold tabular-nums">
                        <Money cents={Math.max(r.position.balanceCents, 0)} />
                      </td>
                      <td>{r.position.nextDueDate ? formatShort(r.position.nextDueDate) : "—"}</td>
                      <td>
                        <RentStatusBadge status={r.position.status} />
                        {r.position.status === "OVERDUE" ? <span className="ml-2 text-xs font-bold text-bad">{r.position.daysOverdue}d</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          <Card title="Applications">
            <p className="font-serif text-4xl font-semibold text-forest-deep">{d.pendingApplications}</p>
            <p className="text-muted">waiting for review</p>
            <Link href="/admin/applications" className="btn-secondary btn-sm mt-3">
              Review applications
            </Link>
          </Card>
          <Card title="Maintenance">
            <p className="font-serif text-4xl font-semibold text-forest-deep tabular-nums">{repairs.open}</p>
            <p className="text-muted">
              open request{repairs.open === 1 ? "" : "s"}
              {repairs.urgent ? <span className="font-bold text-bad"> · {repairs.urgent} urgent</span> : null}
              {repairs.submitted ? <span> · {repairs.submitted} new</span> : null}
            </p>
            <Link href="/admin/maintenance" className="btn-secondary btn-sm mt-3">
              Open maintenance queue
            </Link>
          </Card>
          <Card title="Recent payments" action={<Link href="/admin/payments" className="text-sm font-bold">All</Link>}>
            {d.recentPayments.length === 0 ? (
              <p className="text-muted">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-bold">
                        {p.resident.firstName} {p.resident.lastName}
                      </p>
                      <p className="text-xs text-muted">
                        {PAYMENT_METHOD_LABELS[p.method]} · {formatShort(paymentDate(p, settings.timezone))}
                      </p>
                    </div>
                    <Link href={`/receipts/${p.id}`} className="font-bold tabular-nums">
                      {formatCents(p.amountCents)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
