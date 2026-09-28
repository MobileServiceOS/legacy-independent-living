/**
 * Payment orchestration. Money only enters the ledger when a payment reaches
 * SUCCEEDED (and leaves it on REFUNDED), keyed by payment id so webhooks,
 * retries and the sandbox can never post it twice.
 */
import { Prisma, type Payment, type PaymentMethodType } from "@prisma/client";
import { formatLong, type DateOnly } from "../domain/dates";
import { formatCents } from "../domain/money";
import {
  assertTransition,
  canTransition,
  isOnlineMethod,
  makeReceiptNumber,
  PAYMENT_METHOD_LABELS,
  validatePaymentAmount,
  validateRefundAmount,
  type PaymentStatus,
} from "../domain/payments";
import { audit, AUDIT_ACTIONS, SYSTEM_ACTOR, type Actor } from "../lib/audit";
import { prisma, type Tx } from "../lib/db";
import { env } from "../lib/env";
import { notify, notifyAdmins } from "../lib/notify";
import { paymentsStatus } from "../lib/payments";
import type { OnlineMethod, ProviderEvent } from "../lib/payments/provider";
import { businessToday, getSettings, paymentPolicyOf } from "../lib/settings";
import { ForbiddenError, NotFoundError, UserError } from "./errors";
import { postLedgerEntry, residentFinancials } from "./ledger";

async function uniqueReceiptNumber(tx: Tx, today: DateOnly): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const candidate = makeReceiptNumber(today);
    const clash = await tx.payment.findUnique({ where: { receiptNumber: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  throw new Error("Could not allocate a receipt number");
}

async function lockPayment(tx: Tx, paymentId: string): Promise<Payment> {
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
  const p = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw new NotFoundError("Payment");
  return p;
}

// ------------------------------------------------------------------ online

export async function startOnlinePayment(
  user: { id: string; email: string },
  input: { amount: number; method: OnlineMethod },
): Promise<{ paymentId: string; redirectUrl: string }> {
  const settings = await getSettings();
  if (!settings.onlinePaymentsEnabled) throw new UserError("Online payments are turned off right now. Please contact the office.");
  const today = businessToday(settings);
  const status = paymentsStatus();
  if (!status.configured) throw new UserError("Online payments aren't set up yet. Please pay the office directly.");
  const provider = status.provider;
  if (!provider.methods.includes(input.method)) throw new UserError("That payment method isn't available", "method");

  const payment = await prisma.$transaction(async (tx) => {
    const resident = await tx.resident.findUnique({ where: { userId: user.id } });
    if (!resident) throw new ForbiddenError();
    await tx.$queryRaw`SELECT id FROM residents WHERE id = ${resident.id} FOR UPDATE`;
    const { position } = await residentFinancials(tx, resident.id, today);
    const payable = position.balanceCents - position.pendingCents;
    const problem = validatePaymentAmount(input.amount, payable, paymentPolicyOf(settings));
    if (problem) throw new UserError(problem, "amount");
    return tx.payment.create({
      data: {
        residentId: resident.id,
        amountCents: input.amount,
        method: input.method,
        status: "PENDING",
        provider: provider.name,
        receiptNumber: await uniqueReceiptNumber(tx, today),
        initiatedById: user.id,
      },
    });
  });

  try {
    const session = await provider.createCheckout({
      paymentId: payment.id,
      residentId: payment.residentId,
      amountCents: payment.amountCents,
      method: input.method,
      description: `Rent payment — ${settings.businessName}`,
      reference: payment.receiptNumber,
      customerEmail: user.email,
      // Redirect processors (PayPal) come back through a route that captures server-side.
      successUrl: provider.completeReturn ? `${env.appUrl}/api/pay/return?payment=${payment.id}` : `${env.appUrl}/pay/return?payment=${payment.id}`,
      cancelUrl: provider.completeReturn ? `${env.appUrl}/api/pay/cancel?payment=${payment.id}` : `${env.appUrl}/pay?canceled=1`,
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { providerRef: session.providerRef } });
    return { paymentId: payment.id, redirectUrl: session.redirectUrl };
  } catch (err) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureReason: `Checkout could not start: ${(err as Error).message}`.slice(0, 300) },
    });
    throw new UserError("We couldn't start the payment. Please try again in a minute.");
  }
}

async function settleSucceeded(tx: Tx, payment: Payment, today: DateOnly, extra: { cardBrand?: string | null; last4?: string | null }) {
  const updated = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "SUCCEEDED",
      processedAt: new Date(),
      paidOn: payment.paidOn ?? new Date(`${today}T00:00:00.000Z`),
      cardBrand: extra.cardBrand ?? payment.cardBrand,
      last4: extra.last4 && /^\d{4}$/.test(extra.last4) ? extra.last4 : payment.last4,
    },
  });
  await postLedgerEntry(tx, null, {
    residentId: payment.residentId,
    type: "PAYMENT",
    amountCents: -payment.amountCents,
    description: `${PAYMENT_METHOD_LABELS[payment.method]} payment — receipt ${payment.receiptNumber}`,
    effectiveDate: today,
    paymentId: payment.id,
    idempotencyKey: `payment:${payment.id}`,
  });
  const resident = await tx.resident.findUnique({ where: { id: payment.residentId }, select: { userId: true } });
  if (resident?.userId) {
    await notify(tx, {
      userId: resident.userId,
      type: "PAYMENT_SUCCEEDED",
      title: "Payment received — thank you",
      body: `We received your payment of ${formatCents(payment.amountCents)}. Receipt ${payment.receiptNumber}.`,
      link: `/receipts/${payment.id}`,
      dedupeKey: `payment-succeeded:${payment.id}`,
    });
  }
  return updated;
}

async function settleRefunded(tx: Tx, actor: Actor, payment: Payment, today: DateOnly, refundRef: string | null, reason: string) {
  await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED", refundedAt: new Date(), refundRef } });
  await postLedgerEntry(tx, actor, {
    residentId: payment.residentId,
    type: "REFUND",
    amountCents: payment.amountCents,
    description: `Refund of receipt ${payment.receiptNumber}${reason ? ` — ${reason}` : ""}`,
    effectiveDate: today,
    dueDate: today,
    paymentId: payment.id,
    idempotencyKey: `refund:${payment.id}`,
  });
  await audit(tx, actor, AUDIT_ACTIONS.paymentRefunded, "payment", payment.id, {
    residentId: payment.residentId,
    amountCents: payment.amountCents,
    reason,
    refundRef,
  });
  const resident = await tx.resident.findUnique({ where: { id: payment.residentId }, select: { userId: true } });
  if (resident?.userId) {
    await notify(tx, {
      userId: resident.userId,
      type: "PAYMENT_REFUNDED",
      title: "Payment refunded",
      body: `Your payment of ${formatCents(payment.amountCents)} (receipt ${payment.receiptNumber}) was refunded.`,
      link: `/receipts/${payment.id}`,
      dedupeKey: `payment-refunded:${payment.id}`,
    });
  }
}

/**
 * Apply a normalized provider event. Idempotent per event id (payment_events
 * has a unique index) and per payment (state machine + ledger idempotency).
 */
/**
 * Why a processor event can't be trusted for this payment, or null when it can.
 * Guards against events for a different order that carry our payment id (for
 * example a buyer-created PayPal order with custom_id copied from ours) and
 * against partial captures being booked as full payments.
 */
export function eventMismatch(providerName: "MOCK" | "STRIPE" | "PAYPAL", event: Exclude<ProviderEvent, { kind: "ignored" }>, payment: Pick<Payment, "amountCents" | "providerRef" | "provider">): string | null {
  if (payment.provider !== providerName) return `event is from ${providerName} but the payment was made with ${payment.provider}`;
  const f = event.facts;
  if (f?.currency && f.currency !== "USD") return `currency ${f.currency} (expected USD)`;
  if ((event.kind === "succeeded" || event.kind === "processing") && f?.amountCents != null && f.amountCents !== payment.amountCents)
    return `amount ${formatCents(f.amountCents)} (expected ${formatCents(payment.amountCents)})`;
  if (providerName === "PAYPAL") {
    if (event.kind === "succeeded" && f?.amountCents == null) return "PayPal did not report the captured amount";
    const refs = [f?.orderId, event.providerRef].filter((r): r is string => !!r);
    if (!payment.providerRef || !refs.includes(payment.providerRef)) return "it belongs to a different PayPal order";
  }
  return null;
}

export async function applyProviderEvent(providerName: "MOCK" | "STRIPE" | "PAYPAL", event: ProviderEvent): Promise<{ applied: boolean; status?: PaymentStatus }> {
  if (event.kind === "ignored") return { applied: false };
  const settings = await getSettings();
  const today = businessToday(settings);

  return prisma.$transaction(async (tx) => {
    let payment: Payment | null = null;
    if (event.paymentId) payment = await tx.payment.findUnique({ where: { id: event.paymentId } });
    if (!payment && event.providerRef) payment = await tx.payment.findUnique({ where: { providerRef: event.providerRef } });
    if (!payment) throw new NotFoundError("Payment for provider event");

    // Dedupe: a replayed event is a no-op. (A concurrent duplicate hits the unique
    // index, rolls this transaction back, and the provider's retry lands here.)
    const seen = await tx.paymentEvent.findUnique({ where: { eventId: event.eventId }, select: { id: true } });
    if (seen) return { applied: false, status: payment.status };
    await tx.paymentEvent.create({
      data: { paymentId: payment.id, provider: providerName, eventId: event.eventId, kind: event.kind, payload: event as unknown as Prisma.InputJsonValue },
    });

    payment = await lockPayment(tx, payment.id);

    // The event must be about THIS payment's money: same order, same amount, USD.
    const mismatch = eventMismatch(providerName, event, payment);
    if (mismatch) {
      await audit(tx, SYSTEM_ACTOR, "payment.event_mismatch", "payment", payment.id, { event: event.kind, eventId: event.eventId, reason: mismatch });
      await notifyAdmins(tx, {
        type: "PAYMENT_FAILED",
        title: "Payment needs review",
        body: `A ${providerName === "PAYPAL" ? "PayPal" : "processor"} "${event.kind}" event for payment ${payment.receiptNumber} was ignored: ${mismatch}. Nothing was posted to the ledger.`,
        link: `/admin/payments?q=${payment.receiptNumber}`,
        dedupeKey: `mismatch:${event.eventId}`,
      });
      console.warn(`[payments] ignored ${event.kind} event ${event.eventId} for ${payment.id}: ${mismatch}`);
      return { applied: false, status: payment.status };
    }

    const refUpdate = event.providerRef && event.providerRef !== payment.providerRef ? { providerRef: event.providerRef } : {};

    const target: Record<Exclude<ProviderEvent["kind"], "ignored">, PaymentStatus> = {
      processing: "PROCESSING",
      succeeded: "SUCCEEDED",
      failed: "FAILED",
      canceled: "CANCELED",
      refunded: "REFUNDED",
    };
    const to = target[event.kind];
    if (payment.status === to) return { applied: false, status: payment.status };
    if (!canTransition(payment.status, to)) {
      // e.g. money succeeded after we marked it canceled — needs a human.
      await audit(tx, SYSTEM_ACTOR, "payment.anomalous_event", "payment", payment.id, { from: payment.status, event: event.kind });
      await notifyAdmins(tx, {
        type: "PAYMENT_FAILED",
        title: "Payment needs review",
        body: `Payment ${payment.receiptNumber} received a "${event.kind}" event while ${payment.status}. Check the processor dashboard.`,
        link: `/admin/payments?q=${payment.receiptNumber}`,
        dedupeKey: `anomaly:${event.eventId}`,
      });
      return { applied: false, status: payment.status };
    }

    if (Object.keys(refUpdate).length) payment = await tx.payment.update({ where: { id: payment.id }, data: refUpdate });
    const resident = await tx.resident.findUnique({ where: { id: payment.residentId }, select: { userId: true, firstName: true, lastName: true } });

    switch (event.kind) {
      case "processing":
        await tx.payment.update({ where: { id: payment.id }, data: { status: "PROCESSING" } });
        if (resident?.userId)
          await notify(tx, {
            userId: resident.userId,
            type: "PAYMENT_PENDING",
            title: "Bank payment is processing",
            body: `Your bank payment of ${formatCents(payment.amountCents)} is on its way. Bank transfers usually clear in 3–5 business days.`,
            link: `/receipts/${payment.id}`,
            dedupeKey: `payment-pending:${payment.id}`,
          });
        break;
      case "succeeded":
        await settleSucceeded(tx, payment, today, { cardBrand: event.cardBrand, last4: event.last4 });
        break;
      case "failed":
        await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: event.reason.slice(0, 300) } });
        if (resident?.userId)
          await notify(tx, {
            userId: resident.userId,
            type: "PAYMENT_FAILED",
            title: "Payment didn't go through",
            body: `Your payment of ${formatCents(payment.amountCents)} failed: ${event.reason}. Your balance has not changed.`,
            link: "/pay",
            dedupeKey: `payment-failed:${payment.id}`,
          });
        await notifyAdmins(tx, {
          type: "PAYMENT_FAILED",
          title: "Resident payment failed",
          body: `${resident?.firstName ?? ""} ${resident?.lastName ?? ""}: ${formatCents(payment.amountCents)} ${PAYMENT_METHOD_LABELS[payment.method]} — ${event.reason}`,
          link: `/admin/residents/${payment.residentId}`,
          dedupeKey: `payment-failed-admin:${payment.id}`,
        });
        break;
      case "canceled":
        await tx.payment.update({ where: { id: payment.id }, data: { status: "CANCELED" } });
        break;
      case "refunded":
        await settleRefunded(tx, SYSTEM_ACTOR, payment, today, null, "Refunded by payment processor");
        break;
    }
    return { applied: true, status: to };
  });
}

/** Sandbox checkout outcome (mock provider only). */
export async function completeSandboxPayment(
  user: { id: string },
  paymentId: string,
  outcome: "succeed" | "decline" | "ach_pending" | "cancel",
): Promise<PaymentStatus> {
  const status = paymentsStatus();
  if (!status.configured || status.provider.name !== "MOCK") throw new ForbiddenError();
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { resident: { select: { userId: true } } } });
  if (!payment || payment.resident.userId !== user.id) throw new NotFoundError("Payment");
  if (payment.provider !== "MOCK") throw new ForbiddenError();
  if (outcome === "ach_pending" && payment.method !== "ACH" && payment.method !== "PAYPAL") throw new UserError("Only bank payments can be pending");
  const base = { paymentId, providerRef: null, eventId: `mock:${paymentId}:${outcome}` };
  const paypal = payment.method === "PAYPAL";
  const ach = payment.method === "ACH";
  const event: ProviderEvent =
    outcome === "succeed"
      ? { kind: "succeeded", ...base, cardBrand: ach ? null : paypal ? "PayPal" : "Sandbox", last4: ach ? "6789" : paypal ? null : "4242" }
      : outcome === "decline"
        ? { kind: "failed", ...base, reason: ach ? "The bank declined the transfer (sandbox)" : paypal ? "PayPal declined the payment (sandbox)" : "Card declined (sandbox)" }
        : outcome === "ach_pending"
          ? { kind: "processing", ...base }
          : { kind: "canceled", ...base };
  const result = await applyProviderEvent("MOCK", event);
  return result.status ?? payment.status;
}

/** Admin tool (mock provider only): simulate a processing ACH clearing or bouncing. */
export async function simulateAchResult(actor: Actor, paymentId: string, cleared: boolean): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== "MOCK" || payment.status !== "PROCESSING") throw new UserError("Only sandbox bank payments that are processing can be simulated");
  await applyProviderEvent(
    "MOCK",
    cleared
      ? { kind: "succeeded", paymentId, providerRef: null, eventId: `mock:${paymentId}:ach_cleared`, last4: "6789" }
      : { kind: "failed", paymentId, providerRef: null, eventId: `mock:${paymentId}:ach_returned`, reason: "Bank transfer returned (sandbox)" },
  );
  await audit(prisma, actor, cleared ? "payment.sandbox_ach_cleared" : "payment.sandbox_ach_returned", "payment", paymentId);
}

// ------------------------------------------------------------------ offline + refunds

export async function recordOfflinePayment(
  actor: Actor,
  input: { residentId: string; amount: number; paidOn: DateOnly; method: Extract<PaymentMethodType, "CASH" | "MONEY_ORDER" | "CHECK" | "EXTERNAL">; reference: string; note: string | null },
): Promise<Payment> {
  if (isOnlineMethod(input.method)) throw new UserError("Use an offline method");
  const settings = await getSettings();
  const today = businessToday(settings);
  if (input.paidOn > today) throw new UserError("Payment date can't be in the future", "paidOn");
  return prisma.$transaction(async (tx) => {
    const resident = await tx.resident.findUnique({ where: { id: input.residentId } });
    if (!resident) throw new NotFoundError("Resident");
    const payment = await tx.payment.create({
      data: {
        residentId: resident.id,
        amountCents: input.amount,
        method: input.method,
        status: "SUCCEEDED",
        provider: "OFFLINE",
        receiptNumber: await uniqueReceiptNumber(tx, input.paidOn),
        reference: input.reference,
        note: input.note,
        paidOn: new Date(`${input.paidOn}T00:00:00.000Z`),
        processedAt: new Date(),
        recordedById: actor.id,
      },
    });
    await postLedgerEntry(tx, actor, {
      residentId: resident.id,
      type: "PAYMENT",
      amountCents: -input.amount,
      description: `${PAYMENT_METHOD_LABELS[input.method]} payment — ${input.reference}`,
      effectiveDate: input.paidOn,
      paymentId: payment.id,
      idempotencyKey: `payment:${payment.id}`,
    });
    await audit(tx, actor, AUDIT_ACTIONS.manualPaymentRecorded, "payment", payment.id, {
      residentId: resident.id,
      amountCents: input.amount,
      method: input.method,
      paidOn: input.paidOn,
      reference: input.reference,
    });
    if (resident.userId) {
      await notify(tx, {
        userId: resident.userId,
        type: "PAYMENT_SUCCEEDED",
        title: "Payment recorded",
        body: `The office recorded your ${PAYMENT_METHOD_LABELS[input.method].toLowerCase()} payment of ${formatCents(input.amount)} on ${formatLong(input.paidOn)}.`,
        link: `/receipts/${payment.id}`,
        dedupeKey: `payment-succeeded:${payment.id}`,
      });
    }
    return payment;
  });
}

export async function refundPayment(actor: Actor, input: { paymentId: string; reason: string }): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment) throw new NotFoundError("Payment");
  assertTransitionOrUserError(payment.status, "REFUNDED");
  const problem = validateRefundAmount(payment.amountCents, payment.amountCents);
  if (problem) throw new UserError(problem);

  let refundRef: string | null = null;
  if (payment.provider !== "OFFLINE") {
    if (!payment.providerRef) throw new UserError("This payment has no processor reference to refund");
    const status = paymentsStatus();
    if (!status.configured || status.provider.name !== payment.provider)
      throw new UserError(`This payment was made with ${payment.provider}; that processor isn't active, so it can't be refunded here`);
    const provider = status.provider;
    refundRef = (await provider.refund({ paymentId: payment.id, providerRef: payment.providerRef, amountCents: payment.amountCents })).refundRef;
  }
  const settings = await getSettings();
  await prisma.$transaction(async (tx) => {
    const locked = await lockPayment(tx, payment.id);
    if (locked.status === "REFUNDED") return; // webhook got there first
    assertTransition(locked.status, "REFUNDED");
    await settleRefunded(tx, actor, locked, businessToday(settings), refundRef, input.reason);
  });
}

function assertTransitionOrUserError(from: PaymentStatus, to: PaymentStatus) {
  if (!canTransition(from, to)) throw new UserError(`A ${from.toLowerCase()} payment can't be ${to.toLowerCase()}`);
}

// ------------------------------------------------------------------ redirect processors (PayPal)

/**
 * Resident returned from the processor: capture server-side and settle.
 * Idempotent — refreshing the return URL, or a webhook arriving first, is harmless.
 */
export async function completeRedirectPayment(user: { id: string }, paymentId: string): Promise<PaymentStatus> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { resident: { select: { userId: true } } } });
  if (!payment || payment.resident.userId !== user.id) throw new NotFoundError("Payment");
  if (payment.status !== "PENDING") return payment.status; // already settled (webhook or earlier return)
  const status = paymentsStatus();
  const provider = status.configured ? status.provider : null;
  if (!provider || provider.name !== payment.provider || !provider.completeReturn || !payment.providerRef) throw new UserError("This payment can't be completed here");
  let event: ProviderEvent;
  try {
    event = await provider.completeReturn({ paymentId: payment.id, providerRef: payment.providerRef });
  } catch (err) {
    console.error("[payments] capture failed", err);
    throw new UserError("We couldn't confirm your payment with PayPal yet. If money was taken, it will show up shortly.");
  }
  const result = await applyProviderEvent(provider.name, event);
  return result.status ?? (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status;
}

/** Resident backed out on the processor's page: close the pending payment. */
export async function cancelRedirectPayment(user: { id: string }, paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { resident: { select: { userId: true } } } });
  if (!payment || payment.resident.userId !== user.id || payment.status !== "PENDING") return;
  if (payment.provider === "OFFLINE") return;
  await applyProviderEvent(payment.provider, { kind: "canceled", paymentId: payment.id, providerRef: null, eventId: `return:${payment.id}:canceled` });
}
