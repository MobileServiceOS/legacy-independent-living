import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, RadioCards, SubmitButton, Hidden } from "@/components/form";
import { PayAheadAmount } from "@/components/pay-ahead";
import { Icon } from "@/components/icons";
import { BackLink, Card, Notice } from "@/components/ui";
import { formatLong } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { payAheadCeilingCents } from "@/domain/payments";
import { requireResidentPage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { paymentsStatus, type PaymentProvider } from "@/lib/payments";
import { businessToday, getSettings, paymentPolicyOf } from "@/lib/settings";
import { residentFinancials } from "@/server/ledger";
import { startPaymentAction } from "@/app/actions/resident";

export const metadata: Metadata = { title: "Pay rent" };

const METHOD_OPTIONS = {
  PAYPAL: { value: "PAYPAL", label: "PayPal", description: "PayPal balance, bank, or card — paid right away" },
  DEBIT_CARD: { value: "DEBIT_CARD", label: "Debit card", description: "Paid right away" },
  CREDIT_CARD: { value: "CREDIT_CARD", label: "Credit card", description: "Paid right away" },
  CASH_APP: { value: "CASH_APP", label: "Cash App Pay", description: "Pay from your Cash App — paid right away" },
  ACH: { value: "ACH", label: "Bank account (ACH)", description: "Lowest fee · takes 3–5 business days to clear" },
} as const;
export const dynamic = "force-dynamic";

export default async function PayPage({ searchParams }: { searchParams: Promise<{ canceled?: string }> }) {
  const user = await requireResidentPage();
  const { canceled } = await searchParams;
  const settings = await getSettings();
  const { position, schedule } = await residentFinancials(prisma, user.residentId, businessToday(settings));
  const payable = position.balanceCents - position.pendingCents;
  const payments = paymentsStatus();
  const policy = paymentPolicyOf(settings);
  const monthlyRentCents = schedule?.monthlyRentCents ?? 0;
  const aheadCeilingCents = payAheadCeilingCents(monthlyRentCents, policy);
  const onlineAvailable = settings.onlinePaymentsEnabled && payments.configured;
  const canPayAnything = payable > 0 || (onlineAvailable && aheadCeilingCents > 0);

  return (
    <div className="space-y-5">
      <BackLink href="/home">Back to home</BackLink>
      <h1 className="text-4xl">Pay rent</h1>
      {canceled ? <Notice tone="neutral">Payment canceled — nothing was charged.</Notice> : null}

      {!canPayAnything ? (
        <Card>
          <p className="flex items-center gap-2 text-lg font-bold text-ok">
            <Icon name="check" className="size-6" /> Nothing to pay right now.
          </p>
          {position.pendingCents > 0 ? <p className="mt-1 text-muted">Your bank payment of {formatCents(position.pendingCents)} is still processing.</p> : null}
          <Link href="/home" className="btn-secondary mt-4">
            Back to home
          </Link>
        </Card>
      ) : !onlineAvailable ? (
        <Notice tone="warn" title={payments.configured ? "Online payments are paused" : "Online payments aren’t available yet"}>
          Please pay the office directly{settings.supportPhone ? ` or call ${settings.supportPhone}` : ""}.
        </Notice>
      ) : (
        <PayForm
          payable={payable}
          nextDueDate={position.nextDueDate}
          provider={payments.provider}
          settings={settings}
          monthlyRentCents={monthlyRentCents}
          maxPayAheadMonths={policy.allowPayAhead ? policy.maxPayAheadMonths : 0}
        />
      )}
    </div>
  );
}

function PayForm({
  payable,
  nextDueDate,
  provider,
  settings,
  monthlyRentCents,
  maxPayAheadMonths,
}: {
  payable: number;
  nextDueDate: string | null;
  provider: PaymentProvider;
  settings: Awaited<ReturnType<typeof getSettings>>;
  monthlyRentCents: number;
  maxPayAheadMonths: number;
}) {
  const sandbox = provider.isSandbox;
  return (
    <Card>
          <div className="mb-5 rounded-xl bg-paper-2 p-4">
            <p className="text-sm font-extrabold uppercase tracking-wider text-muted">Amount due</p>
            <p className="font-serif text-4xl font-semibold tabular-nums">{formatCents(Math.max(payable, 0))}</p>
            {payable <= 0 ? <p className="text-muted">You&rsquo;re all paid up.</p> : nextDueDate ? <p className="text-muted">Due {formatLong(nextDueDate)}</p> : null}
          </div>
          <ActionForm action={startPaymentAction} className="space-y-5">
            <PayAheadAmount
              payableCents={payable}
              monthlyRentCents={monthlyRentCents}
              maxMonths={maxPayAheadMonths}
              allowPartialPayments={settings.allowPartialPayments}
              minPartialPaymentCents={settings.minPartialPaymentCents}
            />
            {provider.methods.length > 1 ? (
              <RadioCards
                name="method"
                label="How would you like to pay?"
                defaultValue={provider.methods[0]}
                options={provider.methods.map((m) => METHOD_OPTIONS[m])}
              />
            ) : (
              <>
                <Hidden name="method" value={provider.methods[0]!} />
                <p className="rounded-xl bg-paper-2 px-4 py-3 text-[0.95rem]">
                  You’ll pay on PayPal’s secure page with your <strong>PayPal account, bank, or debit/credit card</strong> — no PayPal account needed.
                </p>
              </>
            )}
            <SubmitButton className="min-h-14 w-full text-lg" pendingText="Opening secure checkout…">
              {provider.methods.length === 1 && provider.methods[0] === "PAYPAL" ? "Continue to PayPal" : "Continue to secure checkout"}
            </SubmitButton>
            <p className="flex items-start gap-2 text-sm text-muted" data-sandbox={sandbox || undefined}>
              <Icon name="shield" className="mt-0.5 size-4 shrink-0" />
              {sandbox
                ? "Sandbox mode: no real money will move. Card and bank details are never entered or stored in this app."
                : `You'll enter your payment details on ${provider.name === "PAYPAL" ? "PayPal's" : provider.name === "STRIPE" ? "Stripe's" : "our payment processor's"} secure page. Legacy never sees or stores them.`}
            </p>
          </ActionForm>
    </Card>
  );
}
