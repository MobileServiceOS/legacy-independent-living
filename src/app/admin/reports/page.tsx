import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, Money, PageHeader, RentStatusBadge, Stat, TableWrap } from "@/components/ui";
import { formatMonth, formatShort } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { requirePagePermission } from "@/lib/auth/session";
import { businessToday, getSettings } from "@/lib/settings";
import { recentMonths, reports } from "@/server/queries";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string; propertyId?: string }> }) {
  await requirePagePermission("reports:read");
  const sp = await searchParams;
  const today = businessToday(await getSettings());
  const r = await reports(today, { month: sp.month, propertyId: sp.propertyId || undefined });
  const scope = sp.propertyId ? (r.properties.find((p) => p.id === sp.propertyId)?.name ?? "Property") : "All properties";

  return (
    <>
      <PageHeader title="Reports" description={`${scope} · ${formatMonth(r.month)}`} actions={<PrintHint />} />
      <Card className="no-print mb-6">
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="label" htmlFor="month">
              Month
            </label>
            <select id="month" name="month" defaultValue={r.month} className="input">
              {recentMonths(today, 18).map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="propertyId">
              Property
            </label>
            <select id="propertyId" name="propertyId" defaultValue={sp.propertyId ?? ""} className="input">
              <option value="">All properties</option>
              {r.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn-primary" type="submit">
              Run report
            </button>
          </div>
        </form>
      </Card>

      <h2 className="mb-3 text-2xl">Rent collection · {formatMonth(r.month)}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Expected rent" value={formatCents(r.collection.expectedCents)} />
        <Stat label="Collected" value={formatCents(r.collection.collectedCents)} tone="ok" />
        <Stat label="Outstanding" value={formatCents(r.collection.outstandingCents)} tone={r.collection.outstandingCents ? "warn" : undefined} />
        <Stat label="Collection rate" value={`${r.collection.collectionRate}%`} />
      </div>

      <h2 className="mb-3 mt-8 text-2xl">Occupancy (today)</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total rooms" value={r.occupancy.totalRooms} />
        <Stat label="Occupied" value={r.occupancy.occupied} />
        <Stat label="Available" value={r.occupancy.available} tone="ok" />
        <Stat label="Occupancy" value={`${r.occupancy.occupancyRate}%`} />
      </div>
      {r.byProperty.length > 1 ? (
        <Card className="mt-3">
          <TableWrap>
            <table className="table min-w-[32rem]">
              <thead>
                <tr>
                  <th>Property</th>
                  <th className="text-right">Rooms</th>
                  <th className="text-right">Occupied</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Occupancy</th>
                </tr>
              </thead>
              <tbody>
                {r.byProperty.map((p) => (
                  <tr key={p.id}>
                    <td className="font-bold">{p.name}</td>
                    <td className="text-right">{p.occupancy.totalRooms}</td>
                    <td className="text-right">{p.occupancy.occupied}</td>
                    <td className="text-right">{p.occupancy.available}</td>
                    <td className="text-right">{p.occupancy.occupancyRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}

      <h2 className="mb-3 mt-8 text-2xl">Outstanding balances (today)</h2>
      <Card>
        {r.outstanding.length === 0 ? (
          <EmptyState title="Nobody owes anything right now" icon="check" />
        ) : (
          <TableWrap>
            <table className="table min-w-[44rem]">
              <thead>
                <tr>
                  <th>Resident</th>
                  <th>Property</th>
                  <th>Room</th>
                  <th className="text-right">Balance</th>
                  <th className="text-right">Days overdue</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {r.outstanding.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/residents/${o.id}`} className="font-bold">
                        {o.name}
                      </Link>
                    </td>
                    <td>{o.propertyName ?? "—"}</td>
                    <td>{o.roomName ?? "—"}</td>
                    <td className="text-right font-semibold tabular-nums">
                      <Money cents={o.position.balanceCents} />
                    </td>
                    <td className="text-right tabular-nums">{o.position.daysOverdue || "—"}</td>
                    <td>
                      <RentStatusBadge status={o.position.status} />
                      {o.position.nextDueDate ? <span className="ml-2 text-xs text-muted">since {formatShort(o.position.nextDueDate)}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="font-bold">
                    Total
                  </td>
                  <td className="text-right font-bold tabular-nums">
                    <Money cents={r.outstanding.reduce((s, o) => s + o.position.balanceCents, 0)} />
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

function PrintHint() {
  return <span className="no-print text-sm text-muted">Tip: use your browser's Print to save a PDF.</span>;
}
