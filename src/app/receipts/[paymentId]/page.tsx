import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { DemoTag, PaymentStatusBadge } from "@/components/ui";
import { formatLong } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { PAYMENT_METHOD_LABELS } from "@/domain/payments";
import { canAccessResidentRecord } from "@/domain/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateTime, paymentDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const user = await requireUser();
  const { paymentId } = await params;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      resident: {
        include: { assignments: { orderBy: { startDate: "desc" }, take: 1, include: { room: { include: { property: true } } } } },
      },
    },
  });
  // Same 404 for "doesn't exist" and "not yours" — no probing other residents' receipts.
  if (!payment || !canAccessResidentRecord({ role: user.role, residentId: user.residentId }, payment.residentId, "payments:read")) notFound();
  if (payment.status === "PENDING" || payment.status === "CANCELED") notFound();

  const settings = await getSettings();
  const a = payment.resident.assignments[0];
  const backHref = user.role === "ADMIN" ? `/admin/residents/${payment.residentId}` : "/payments";
  const rows: Array<[string, string]> = [
    ["Receipt number", payment.receiptNumber],
    ["Date", formatLong(paymentDate(payment, settings.timezone))],
    ["Resident", `${payment.resident.firstName} ${payment.resident.lastName}`],
    ...(a ? ([["Home", `${a.room.property.name} · ${a.room.name}`]] as Array<[string, string]>) : []),
    ["Payment method", `${PAYMENT_METHOD_LABELS[payment.method]}${payment.last4 ? ` ending ${payment.last4}` : ""}`],
    ...(payment.reference ? ([["Reference", payment.reference]] as Array<[string, string]>) : []),
    ["Transaction reference", payment.providerRef ?? payment.id],
    ...(payment.refundedAt ? ([["Refunded", formatDateTime(payment.refundedAt, settings.timezone)]] as Array<[string, string]>) : []),
  ];

  return (
    <main id="main" className="mx-auto max-w-xl px-4 pt-[calc(2rem+env(safe-area-inset-top))] pb-8">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Link href={backHref} className="font-bold">
          ← Back
        </Link>
        <PrintButton />
      </div>
      <article className="card p-6 sm:p-8" aria-labelledby="receipt-title">
        <header className="flex items-center gap-4 border-b border-line pb-5">
          <Image src="/brand/logo-mark.webp" alt="" width={64} height={64} className="rounded-full" />
          <div>
            <p className="font-serif text-2xl font-semibold text-forest-deep">{settings.businessName}</p>
            <p className="text-sm text-muted">Payment receipt{payment.resident.isDemo ? <DemoTag /> : null}</p>
          </div>
        </header>
        <div className="py-6 text-center">
          <h1 id="receipt-title" className="sr-only">
            Receipt {payment.receiptNumber}
          </h1>
          <p className="text-sm font-extrabold uppercase tracking-wider text-muted">Amount paid</p>
          <p className="font-serif text-5xl font-semibold tabular-nums text-forest-deep" data-testid="receipt-amount">
            {formatCents(payment.amountCents)}
          </p>
          <div className="mt-2">
            <PaymentStatusBadge status={payment.status} />
          </div>
        </div>
        <dl className="divide-y divide-line border-y border-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">{k}</dt>
              <dd className="break-all text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-center text-sm text-muted">
          {payment.status === "PROCESSING"
            ? "This bank payment is still processing. It will be applied to your balance when it clears."
            : payment.status === "REFUNDED"
              ? "This payment was refunded and is no longer applied to your balance."
              : payment.status === "FAILED"
                ? "This payment did not go through."
                : "Thank you for your payment."}
        </p>
      </article>
    </main>
  );
}
