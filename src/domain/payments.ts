/**
 * Payment lifecycle rules. Payment rows track the processor's view of money
 * movement; ledger entries are only written when money has actually settled
 * (SUCCEEDED) or been returned (REFUNDED). A pending ACH therefore does NOT
 * reduce the balance — it shows as "Payment pending" until it clears.
 */
import { formatCents, type Cents } from "./money.ts";

export const PAYMENT_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "REFUNDED", "CANCELED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Started",
  PROCESSING: "Pending (bank transfer)",
  SUCCEEDED: "Successful",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  CANCELED: "Canceled",
};

export const PAYMENT_METHODS = ["ACH", "DEBIT_CARD", "CREDIT_CARD", "CASH", "MONEY_ORDER", "CHECK", "EXTERNAL", "PAYPAL", "CASH_APP"] as const;
export type PaymentMethodType = (typeof PAYMENT_METHODS)[number];

export const ONLINE_METHODS: readonly PaymentMethodType[] = ["DEBIT_CARD", "CREDIT_CARD", "CASH_APP", "ACH", "PAYPAL"];
export const OFFLINE_METHODS: readonly PaymentMethodType[] = ["CASH", "MONEY_ORDER", "CHECK", "EXTERNAL"];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  ACH: "Bank account (ACH)",
  DEBIT_CARD: "Debit card",
  CREDIT_CARD: "Credit card",
  CASH: "Cash",
  MONEY_ORDER: "Money order",
  CHECK: "Check",
  EXTERNAL: "External payment",
  PAYPAL: "PayPal",
  CASH_APP: "Cash App Pay",
};

export function isOnlineMethod(m: PaymentMethodType): boolean {
  return ONLINE_METHODS.includes(m);
}

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["PROCESSING", "SUCCEEDED", "FAILED", "CANCELED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: ["REFUNDED"],
  FAILED: [],
  REFUNDED: [],
  CANCELED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) throw new Error(`Payment cannot move from ${from} to ${to}`);
}

/** Money still "in flight" — counts toward PENDING rent status, not the balance. */
export function isInFlight(status: PaymentStatus): boolean {
  return status === "PENDING" || status === "PROCESSING";
}

export interface PaymentPolicy {
  allowPartialPayments: boolean;
  /** Smallest partial payment accepted when partial payments are enabled. */
  minPartialPaymentCents: Cents;
  /** Residents may pay ahead of their current balance (future rent, paid in advance). */
  allowPayAhead: boolean;
  /** Cap on how many months of future rent can be prepaid in one payment. */
  maxPayAheadMonths: number;
}

/**
 * How far ahead of the current balance a resident may pay, in cents — 0 when
 * pay-ahead is off, capped at 0 months, or there's no active monthly rent to
 * project against.
 */
export function payAheadCeilingCents(monthlyRentCents: Cents, policy: Pick<PaymentPolicy, "allowPayAhead" | "maxPayAheadMonths">): Cents {
  if (!policy.allowPayAhead || monthlyRentCents <= 0 || policy.maxPayAheadMonths <= 0) return 0;
  return monthlyRentCents * policy.maxPayAheadMonths;
}

/**
 * Validate an online payment amount against the current balance. Paying more
 * than what's currently due is allowed up to `maxPayableCents` (the balance
 * plus any pay-ahead allowance, see `payAheadCeilingCents`) — the excess is
 * banked as a ledger credit and applies automatically to rent as it posts.
 */
export function validatePaymentAmount(
  amountCents: Cents,
  payableCents: Cents,
  maxPayableCents: Cents,
  policy: Pick<PaymentPolicy, "allowPartialPayments" | "minPartialPaymentCents">,
): string | null {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return "Enter an amount greater than $0.00";
  if (maxPayableCents <= 0) return "You have no balance due right now";
  if (amountCents > maxPayableCents) return `The most you can pay right now is ${formatCents(maxPayableCents)}`;
  if (amountCents >= payableCents) return null; // paying the full balance, or paying ahead of it
  if (!policy.allowPartialPayments) return `Please pay the full balance of ${formatCents(payableCents)}`;
  if (amountCents < policy.minPartialPaymentCents)
    return `Partial payments must be at least ${formatCents(policy.minPartialPaymentCents)}`;
  return null;
}

/** Validate a refund amount against what was paid and already refunded. */
export function validateRefundAmount(amountCents: Cents, paidCents: Cents): string | null {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return "Refund must be greater than $0.00";
  if (amountCents !== paidCents) return "Only full refunds are supported in this version";
  return null;
}

/** Human-friendly, unique-enough receipt number: LIL-20261001-7K3QX9 */
export function makeReceiptNumber(dateOnly: string, random: () => number = Math.random): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I confusion
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += alphabet[Math.floor(random() * alphabet.length)];
  return `LIL-${dateOnly.replace(/-/g, "")}-${suffix}`;
}
