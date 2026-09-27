import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ActionForm, Hidden, SubmitButton } from "@/components/form";
import { Card, Notice } from "@/components/ui";
import { formatCents } from "@/domain/money";
import { PAYMENT_METHOD_LABELS } from "@/domain/payments";
import { requireResidentPage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";
import { sandboxOutcomeAction } from "@/app/actions/resident";

export const metadata: Metadata = { title: "Sandbox checkout" };
export const dynamic = "force-dynamic";

function Outcome({ paymentId, outcome, label, variant }: { paymentId: string; outcome: string; label: string; variant: "primary" | "secondary" | "danger" }) {
  return (
    <ActionForm action={sandboxOutcomeAction}>
      <Hidden name="paymentId" value={paymentId} />
      <Hidden name="outcome" value={outcome} />
      <SubmitButton variant={variant} className="w-full" pendingText="Processing…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export default async function SandboxCheckout({ params }: { params: Promise<{ paymentId: string }> }) {
  const user = await requireResidentPage();
  if (getPaymentProvider().name !== "MOCK") notFound();
  const { paymentId } = await params;
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.residentId !== user.residentId || payment.provider !== "MOCK") notFound();
  if (payment.status !== "PENDING") redirect(`/pay/return?payment=${payment.id}`);

  return (
    <div className="space-y-5">
      <h1 className="text-4xl">Secure checkout</h1>
      <Notice tone="warn" title="Sandbox — test mode">
        This stands in for the payment processor’s page. No real money moves. With Stripe connected, residents enter card or bank details on Stripe, never in this app.
      </Notice>
      <Card>
        <dl className="space-y-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Amount</dt>
            <dd className="text-2xl font-bold tabular-nums">{formatCents(payment.amountCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Method</dt>
            <dd className="font-bold">{PAYMENT_METHOD_LABELS[payment.method]}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Receipt #</dt>
            <dd className="font-mono">{payment.receiptNumber}</dd>
          </div>
        </dl>
        <div className="mt-6 grid gap-3">
          {payment.method === "ACH" ? (
            <>
              <Outcome paymentId={payment.id} outcome="ach_pending" label="Submit bank payment" variant="primary" />
              <Outcome paymentId={payment.id} outcome="succeed" label="Simulate: bank payment clears instantly" variant="secondary" />
            </>
          ) : (
            <>
              <Outcome paymentId={payment.id} outcome="succeed" label={`Pay ${formatCents(payment.amountCents)}`} variant="primary" />
              {payment.method === "PAYPAL" ? <Outcome paymentId={payment.id} outcome="ach_pending" label="Simulate: PayPal eCheck pending" variant="secondary" /> : null}
            </>
          )}
          <Outcome paymentId={payment.id} outcome="decline" label="Simulate: payment declined" variant="danger" />
          <Outcome paymentId={payment.id} outcome="cancel" label="Cancel and go back" variant="secondary" />
        </div>
      </Card>
    </div>
  );
}
