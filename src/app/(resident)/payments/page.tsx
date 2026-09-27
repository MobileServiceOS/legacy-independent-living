import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, Money, PaymentStatusBadge, RunningBalance } from "@/components/ui";
import { formatShort } from "@/domain/dates";
import { LEDGER_TYPE_LABELS, withRunningBalance } from "@/domain/ledger";
import { PAYMENT_METHOD_LABELS } from "@/domain/payments";
import { requireResidentPage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { paymentDate } from "@/lib/format";
import { businessToday, getSettings } from "@/lib/settings";
import { residentFinancials } from "@/server/ledger";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const user = await requireResidentPage();
  const settings = await getSettings();
  const [payments, fin] = await Promise.all([
    prisma.payment.findMany({
      where: { residentId: user.residentId, status: { notIn: ["PENDING", "CANCELED"] } },
      orderBy: { createdAt: "desc" },
    }),
    residentFinancials(prisma, user.residentId, businessToday(settings)),
  ]);
  const ledger = withRunningBalance(fin.lines).reverse();

  return (
    <div className="space-y-5">
      <h1 className="text-4xl">Payments</h1>
      <Card title="Payment history">
        {payments.length === 0 ? (
          <EmptyState title="No payments yet" icon="receipt">
            When you pay rent, it will show up here with a receipt.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {payments.map((p) => (
              <li key={p.id}>
                <Link href={`/receipts/${p.id}`} className="flex min-h-16 items-center justify-between gap-3 py-3 text-ink no-underline hover:bg-paper">
                  <div>
                    <p className="text-lg font-bold">
                      <Money cents={p.amountCents} />
                    </p>
                    <p className="text-sm text-muted">
                      {formatShort(paymentDate(p, settings.timezone))} · {PAYMENT_METHOD_LABELS[p.method]}
                    </p>
                    <p className="font-mono text-xs text-muted">{p.receiptNumber}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <PaymentStatusBadge status={p.status} />
                    <span className="text-sm font-bold text-forest">Receipt →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Account activity">
        {ledger.length === 0 ? (
          <p className="text-muted">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ledger.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="font-bold">{LEDGER_TYPE_LABELS[l.type]}</p>
                  <p className="text-sm text-muted">{formatShort(l.effectiveDate)}</p>
                </div>
                <div className="text-right">
                  <p className={`font-bold tabular-nums ${l.amountCents < 0 ? "text-ok" : ""}`}>
                    <Money cents={l.amountCents} signed />
                  </p>
                  <p className="text-xs text-muted">
                    Balance <RunningBalance cents={l.runningBalanceCents} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
