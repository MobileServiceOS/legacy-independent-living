import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PushPrompt } from "@/components/push-controls";
import { vapidConfig } from "@/lib/push";
import { Card, DemoTag, Money, Notice, PaymentStatusBadge, RentStatusBadge } from "@/components/ui";
import { dateOnlyFromDbDate, formatLong, formatShort } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { PAYMENT_METHOD_LABELS, payAheadCeilingCents } from "@/domain/payments";
import { requireResidentPage } from "@/lib/auth/session";
import { paymentDate } from "@/lib/format";
import { prisma } from "@/lib/db";
import { paymentsStatus } from "@/lib/payments";
import { businessToday, getSettings, paymentPolicyOf } from "@/lib/settings";
import { residentFinancials } from "@/server/ledger";
import { ensureRentEngineCurrent } from "@/server/rent-engine";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function ResidentHome() {
  const user = await requireResidentPage();
  await ensureRentEngineCurrent();
  const settings = await getSettings();
  const today = businessToday(settings);
  const [fin, resident, lastPayment, notices, openRepairs] = await Promise.all([
    residentFinancials(prisma, user.residentId, today),
    prisma.resident.findUniqueOrThrow({
      where: { id: user.residentId },
      include: { assignments: { orderBy: { startDate: "desc" }, take: 1, include: { room: { include: { property: true } } } } },
    }),
    prisma.payment.findFirst({ where: { residentId: user.residentId, status: { in: ["SUCCEEDED", "PROCESSING"] } }, orderBy: { createdAt: "desc" } }),
    prisma.notification.findMany({ where: { userId: user.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.maintenanceRequest.count({ where: { residentId: user.residentId, status: { notIn: ["COMPLETED", "CANCELED"] } } }),
  ]);
  const { position, schedule } = fin;
  const assignment = resident.assignments[0];
  const payable = position.balanceCents - position.pendingCents;
  const paidUp = position.status === "PAID";
  const policy = paymentPolicyOf(settings);
  const aheadCeilingCents = payAheadCeilingCents(schedule?.monthlyRentCents ?? 0, policy);
  const canPayAhead = settings.onlinePaymentsEnabled && paymentsStatus().configured && aheadCeilingCents > 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-muted">Hello,</p>
        <h1 className="text-4xl">
          {resident.firstName}
          {resident.isDemo ? <DemoTag /> : null}
        </h1>
        {assignment ? (
          <p className="mt-1 text-muted">
            {assignment.room.property.name} · {assignment.room.name}
          </p>
        ) : null}
      </div>

      {resident.status === "MOVED_OUT" ? (
        <Notice tone="neutral" title="You've moved out">
          {resident.moveOutDate ? `Move-out date: ${formatLong(dateOnlyFromDbDate(resident.moveOutDate))}. ` : ""}
          You can still see your payments and pay any remaining balance here.
        </Notice>
      ) : null}

      <section aria-labelledby="balance-heading" className="card overflow-hidden">
        <div className="bg-forest px-6 pb-6 pt-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <h2 id="balance-heading" className="font-sans text-sm font-extrabold uppercase tracking-[0.16em] text-cream">
              Current balance
            </h2>
            <RentStatusBadge status={position.status} size="lg" />
          </div>
          <p className="mt-2 font-serif text-6xl font-semibold tabular-nums text-white" data-testid="balance">
            {formatCents(Math.max(position.balanceCents, 0))}
          </p>
          {position.creditCents > 0 ? <p className="mt-1 text-cream">You have a {formatCents(position.creditCents)} credit.</p> : null}
        </div>
        <div className="space-y-4 px-6 py-5">
          {paidUp ? (
            <p className="flex items-center gap-2 text-lg font-bold text-ok">
              <Icon name="check" className="size-6" /> You’re all paid up. Thank you!
            </p>
          ) : null}
          {position.nextDueDate ? (
            <div>
              <p className="text-sm font-extrabold uppercase tracking-wider text-muted">{paidUp ? "Next rent due" : position.status === "OVERDUE" ? "Was due" : "Rent due"}</p>
              <p className="text-2xl font-bold" data-testid="due-date">
                {formatLong(position.nextDueDate)}
              </p>
              {position.status === "OVERDUE" ? (
                <p className="font-semibold text-bad">
                  {position.daysOverdue} day{position.daysOverdue === 1 ? "" : "s"} late
                </p>
              ) : null}
            </div>
          ) : null}
          {position.pendingCents > 0 ? (
            <Notice tone="info">
              A bank payment of {formatCents(position.pendingCents)} is on its way. It usually clears in 3–5 business days.
            </Notice>
          ) : null}
          {payable > 0 && settings.onlinePaymentsEnabled ? (
            <Link href="/pay" className="btn-primary min-h-14 w-full text-lg" data-testid="pay-rent">
              Pay rent
              <Icon name="arrowRight" />
            </Link>
          ) : null}
          {payable > 0 && !settings.onlinePaymentsEnabled ? (
            <Notice tone="warn">Online payments are paused. Please pay the office directly{settings.supportPhone ? ` or call ${settings.supportPhone}` : ""}.</Notice>
          ) : null}
          {payable <= 0 && canPayAhead ? (
            <Link href="/pay" className="btn-secondary min-h-14 w-full text-lg" data-testid="pay-ahead">
              Pay ahead on rent
              <Icon name="arrowRight" />
            </Link>
          ) : null}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm font-extrabold uppercase tracking-wider text-muted">Monthly rent</p>
          <p className="mt-1 text-2xl font-bold">{schedule ? <Money cents={schedule.monthlyRentCents} /> : "—"}</p>
          {schedule ? <p className="text-muted">Due on day {schedule.dueDay} of each month</p> : null}
        </Card>
        <Card>
          <p className="text-sm font-extrabold uppercase tracking-wider text-muted">Last payment</p>
          {lastPayment ? (
            <>
              <p className="mt-1 text-2xl font-bold">
                <Money cents={lastPayment.amountCents} />
              </p>
              <p className="flex flex-wrap items-center gap-2 text-muted">
                {formatShort(paymentDate(lastPayment, settings.timezone))} · {PAYMENT_METHOD_LABELS[lastPayment.method]}
                <PaymentStatusBadge status={lastPayment.status} />
              </p>
              <Link href={`/receipts/${lastPayment.id}`} className="mt-2 inline-block font-bold">
                View receipt
              </Link>
            </>
          ) : (
            <p className="mt-1 text-muted">No payments yet.</p>
          )}
        </Card>
      </div>

      <PushPrompt vapidKey={vapidConfig()?.publicKey ?? null} />

      <Link href="/maintenance/new" className="card flex min-h-16 items-center justify-between gap-3 px-5 py-4 text-ink no-underline hover:bg-paper-2">
        <span className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-ok-bg text-forest">
            <Icon name="wrench" className="size-6" />
          </span>
          <span>
            <span className="block text-lg font-bold">Something need fixing?</span>
            <span className="block text-muted">
              {openRepairs ? `${openRepairs} open repair request${openRepairs > 1 ? "s" : ""} · ` : ""}Report a problem
            </span>
          </span>
        </span>
        <Icon name="arrowRight" />
      </Link>

      <Card title="Notices" action={<Link href="/notifications" className="text-sm font-bold">See all</Link>}>
        {notices.length ? (
          <ul className="divide-y divide-line">
            {notices.map((n) => (
              <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                <p className="font-bold">{n.title}</p>
                <p className="text-muted">{n.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">You’re all caught up.</p>
        )}
      </Card>

      {settings.supportPhone || settings.supportEmail ? (
        <p className="text-center text-sm text-muted">
          Questions? Contact the office{settings.supportPhone ? <> at <a href={`tel:${settings.supportPhone}`}>{settings.supportPhone}</a></> : null}
          {settings.supportEmail ? <> · <a href={`mailto:${settings.supportEmail}`}>{settings.supportEmail}</a></> : null}
        </p>
      ) : null}
    </div>
  );
}
