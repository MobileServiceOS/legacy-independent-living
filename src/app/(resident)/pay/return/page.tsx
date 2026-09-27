import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card } from "@/components/ui";
import { formatCents } from "@/domain/money";
import { requireResidentPage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Payment status" };
export const dynamic = "force-dynamic";

export default async function PaymentReturn({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const user = await requireResidentPage();
  const { payment: paymentId } = await searchParams;
  if (!paymentId) notFound();
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.residentId !== user.residentId) notFound();

  const view = {
    SUCCEEDED: { icon: "check", tone: "bg-ok-bg text-ok", title: "Payment successful", body: `Thank you! We received ${formatCents(payment.amountCents)}.` },
    PROCESSING: { icon: "clock", tone: "bg-info-bg text-info", title: "Bank payment submitted", body: `Your ${formatCents(payment.amountCents)} bank payment is processing. It usually clears in 3–5 business days — we'll let you know.` },
    PENDING: { icon: "clock", tone: "bg-paper-2 text-muted", title: "Confirming your payment…", body: "This usually takes a few seconds. This page will refresh." },
    FAILED: { icon: "alert", tone: "bg-bad-bg text-bad", title: "Payment didn't go through", body: `${payment.failureReason ?? "The payment was declined."} Your balance has not changed.` },
    CANCELED: { icon: "x", tone: "bg-paper-2 text-muted", title: "Payment canceled", body: "Nothing was charged." },
    REFUNDED: { icon: "receipt", tone: "bg-partial-bg text-partial", title: "Payment refunded", body: "This payment was refunded." },
  }[payment.status] as { icon: "check" | "clock" | "alert" | "x" | "receipt"; tone: string; title: string; body: string };

  return (
    <div className="space-y-5">
      {payment.status === "PENDING" ? <meta httpEquiv="refresh" content="3" /> : null}
      <Card>
        <div className="flex flex-col items-center py-4 text-center" role="status">
          <span className={`mb-4 grid size-16 place-items-center rounded-full ${view.tone}`}>
            <Icon name={view.icon} className="size-8" />
          </span>
          <h1 className="text-4xl" data-testid="payment-result">
            {view.title}
          </h1>
          <p className="mt-2 max-w-md text-muted">{view.body}</p>
          <div className="mt-6 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            {payment.status === "SUCCEEDED" || payment.status === "PROCESSING" ? (
              <Link href={`/receipts/${payment.id}`} className="btn-primary">
                View receipt
              </Link>
            ) : null}
            {payment.status === "FAILED" ? (
              <Link href="/pay" className="btn-primary">
                Try again
              </Link>
            ) : null}
            <Link href="/home" className="btn-secondary">
              Back to home
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
