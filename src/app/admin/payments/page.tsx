import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Disclosure, Select, SubmitButton } from "@/components/form";
import { OfflinePaymentFields } from "@/components/offline-payment-fields";
import { Card, EmptyState, Money, PageHeader, PaymentStatusBadge, Stat, TableWrap } from "@/components/ui";
import { formatShort } from "@/domain/dates";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, type PaymentMethodType, type PaymentStatus } from "@/domain/payments";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { paymentDate } from "@/lib/format";
import { businessToday, getSettings } from "@/lib/settings";
import { listPayments, type PaymentRange } from "@/server/queries";
import { recordOfflinePaymentAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

type SP = { range?: string; propertyId?: string; method?: string; status?: string; q?: string; record?: string };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("payments:read");
  const sp = await searchParams;
  const settings = await getSettings();
  const today = businessToday(settings);
  const range: PaymentRange = (["today", "week", "month", "all"] as const).includes(sp.range as PaymentRange) ? (sp.range as PaymentRange) : "month";
  const method = PAYMENT_METHODS.includes(sp.method as PaymentMethodType) ? (sp.method as PaymentMethodType) : undefined;
  const status = PAYMENT_STATUSES.includes(sp.status as PaymentStatus) ? (sp.status as PaymentStatus) : undefined;
  const [{ rows, totals }, properties, residents] = await Promise.all([
    listPayments(today, { range, method, status, propertyId: sp.propertyId || undefined, q: sp.q?.slice(0, 100) }),
    prisma.property.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.resident.findMany({ orderBy: [{ status: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true, status: true } }),
  ]);

  return (
    <>
      <PageHeader title="Payments" description="Online, bank and offline payments across all properties." />
      <div className="mb-5">
        <Disclosure summary="Record an offline payment (cash, money order, check…)" defaultOpen={sp.record === "1"}>
          <ActionForm action={recordOfflinePaymentAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess linkResult={{ key: "receiptUrl", label: "Open receipt" }}>
            <div className="sm:col-span-2">
              <Select
                name="residentId"
                label="Resident"
                placeholder="Choose a resident"
                required
                options={residents.map((r) => ({ value: r.id, label: `${r.lastName}, ${r.firstName}${r.status === "MOVED_OUT" ? " (moved out)" : ""}` }))}
              />
            </div>
            <OfflinePaymentFields today={today} />
            <div className="sm:col-span-2">
              <SubmitButton>Record payment</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      </div>

      <Card className="mb-5">
        <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1.5fr_auto]" role="search">
          <div>
            <label className="label" htmlFor="range">
              Period
            </label>
            <select id="range" name="range" defaultValue={range} className="input">
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="all">All time</option>
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
            <label className="label" htmlFor="method">
              Method
            </label>
            <select id="method" name="method" defaultValue={method ?? ""} className="input">
              <option value="">All</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? ""} className="input">
              <option value="">All</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PAYMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="q">
              Search
            </label>
            <input id="q" name="q" defaultValue={sp.q} placeholder="Resident, receipt #, reference" className="input" />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn-primary">
              Filter
            </button>
            <Link href="/admin/payments" className="btn-secondary">
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Payments" value={totals.count} />
        <Stat label="Successful" value={<Money cents={totals.succeededCents} />} tone="ok" />
        <Stat label="Pending (ACH)" value={<Money cents={totals.processingCents} />} />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No payments for these filters" icon="dollar" />
        ) : (
          <TableWrap>
            <table className="table min-w-[64rem]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Resident</th>
                  <th>Property</th>
                  <th className="text-right">Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Transaction reference</th>
                  <th>Entered by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">{formatShort(paymentDate(p, settings.timezone))}</td>
                    <td>
                      <Link href={`/admin/residents/${p.residentId}`} className="font-bold">
                        {p.residentName}
                      </Link>
                    </td>
                    <td>{p.propertyName ? `${p.propertyName}${p.roomName ? ` · ${p.roomName}` : ""}` : "—"}</td>
                    <td className="text-right font-semibold tabular-nums">
                      <Money cents={p.amountCents} />
                    </td>
                    <td>{PAYMENT_METHOD_LABELS[p.method]}</td>
                    <td>
                      <PaymentStatusBadge status={p.status} />
                    </td>
                    <td className="text-xs">
                      {p.status !== "PENDING" && p.status !== "CANCELED" ? (
                        <Link href={`/receipts/${p.id}`} className="font-mono font-bold">
                          {p.receiptNumber}
                        </Link>
                      ) : (
                        <span className="font-mono">{p.receiptNumber}</span>
                      )}
                      {p.reference ? <span className="block text-muted">{p.reference}</span> : null}
                      {p.providerRef ? <span className="block truncate text-muted">{p.providerRef}</span> : null}
                    </td>
                    <td className="text-sm">{p.recordedByName ?? (p.provider === "OFFLINE" ? "—" : "Resident (online)")}</td>
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
