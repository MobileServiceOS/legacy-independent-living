import type { Metadata } from "next";
import Link from "next/link";
import { Card, DemoTag, EmptyState, Money, PageHeader, RentStatusBadge, TableWrap, Badge } from "@/components/ui";
import { formatShort } from "@/domain/dates";
import { RENT_STATUSES, RENT_STATUS_LABELS, type RentStatus } from "@/domain/rent";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { businessToday, getSettings } from "@/lib/settings";
import { listResidents } from "@/server/queries";

export const metadata: Metadata = { title: "Residents" };
export const dynamic = "force-dynamic";

type SP = { q?: string; propertyId?: string; roomId?: string; paymentStatus?: string; status?: string };

export default async function ResidentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("residents:read");
  const sp = await searchParams;
  const status = sp.status === "MOVED_OUT" || sp.status === "ALL" ? sp.status : "ACTIVE";
  const paymentStatus = RENT_STATUSES.includes(sp.paymentStatus as RentStatus) ? (sp.paymentStatus as RentStatus) : undefined;
  const settings = await getSettings();
  const [rows, properties, rooms] = await Promise.all([
    listResidents(businessToday(settings), {
      q: sp.q?.slice(0, 100),
      propertyId: sp.propertyId || undefined,
      roomId: sp.roomId || undefined,
      paymentStatus,
      status,
    }),
    prisma.property.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.room.findMany({ where: sp.propertyId ? { propertyId: sp.propertyId } : {}, orderBy: [{ property: { name: "asc" } }, { name: "asc" }], include: { property: { select: { name: true } } } }),
  ]);
  const selectCls = "input";

  return (
    <>
      <PageHeader
        title="Residents"
        description={`${rows.length} ${status === "ALL" ? "total" : status === "ACTIVE" ? "active" : "moved out"}`}
        actions={
          <Link href="/admin/residents/new" className="btn-primary btn-sm">
            Add resident
          </Link>
        }
      />
      <Card className="mb-5">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]" role="search">
          <div>
            <label htmlFor="q" className="label">
              Search
            </label>
            <input id="q" name="q" defaultValue={sp.q} placeholder="Name, email or phone" className={selectCls} />
          </div>
          <div>
            <label htmlFor="propertyId" className="label">
              Property
            </label>
            <select id="propertyId" name="propertyId" defaultValue={sp.propertyId ?? ""} className={selectCls}>
              <option value="">All</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="roomId" className="label">
              Room
            </label>
            <select id="roomId" name="roomId" defaultValue={sp.roomId ?? ""} className={selectCls}>
              <option value="">All</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.property.name} · {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="paymentStatus" className="label">
              Payment
            </label>
            <select id="paymentStatus" name="paymentStatus" defaultValue={paymentStatus ?? ""} className={selectCls}>
              <option value="">Any</option>
              {RENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="label">
              Residency
            </label>
            <select id="status" name="status" defaultValue={status} className={selectCls}>
              <option value="ACTIVE">Active</option>
              <option value="MOVED_OUT">Moved out</option>
              <option value="ALL">All</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn-primary w-full sm:w-auto">
              Filter
            </button>
            <Link href="/admin/residents" className="btn-secondary">
              Reset
            </Link>
          </div>
        </form>
      </Card>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No residents match" icon="users" />
        ) : (
          <TableWrap>
            <table className="table min-w-[56rem]">
              <thead>
                <tr>
                  <th>Resident</th>
                  <th>Property · Room</th>
                  <th className="text-right">Rent</th>
                  <th className="text-right">Balance</th>
                  <th>Next due</th>
                  <th>Payment</th>
                  <th>Account</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/residents/${r.id}`} className="font-bold">
                        {r.name}
                      </Link>
                      {r.isDemo ? <DemoTag /> : null}
                      <span className="block text-xs text-muted">{r.phone}</span>
                    </td>
                    <td>{r.propertyName ? `${r.propertyName} · ${r.roomName}` : <span className="text-muted">—</span>}</td>
                    <td className="text-right tabular-nums">{r.monthlyRentCents ? <Money cents={r.monthlyRentCents} /> : "—"}</td>
                    <td className="text-right font-semibold tabular-nums">
                      <Money cents={r.position.balanceCents} />
                    </td>
                    <td>{r.position.nextDueDate ? formatShort(r.position.nextDueDate) : "—"}</td>
                    <td>
                      <RentStatusBadge status={r.position.status} />
                    </td>
                    <td>
                      {r.status === "MOVED_OUT" ? (
                        <Badge>Moved out</Badge>
                      ) : r.accountStatus === "ACTIVE" ? (
                        <Badge tone="ok">Active</Badge>
                      ) : r.accountStatus === "INVITED" ? (
                        <Badge tone="warn">Invited</Badge>
                      ) : (
                        <Badge>{r.accountStatus ?? "No login"}</Badge>
                      )}
                    </td>
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
