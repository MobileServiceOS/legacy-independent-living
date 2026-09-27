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

export const PAYMENT_METHODS = ["ACH", "DEBIT_CARD", "CREDIT_CARD", "CASH", "MONEY_ORDER", "CHECK", "EXTERNAL", "PAYPAL"] as const;
export type PaymentMethodType = (typeof PAYMENT_METHODS)[number];

export const ONLINE_METHODS: readonly PaymentMethodType[] = ["PAYPAL", "ACH", "DEBIT_CARD", "CREDIT_CARD"];
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
}

/**
 * Validate an online payment amount against the current balance.
 * Overpayment is never allowed online (it would create unexplained credit).
 */
export function validatePaymentAmount(amountCents: Cents, balanceCents: Cents, policy: PaymentPolicy): string | null {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return "Enter an amount greater than $0.00";
  if (balanceCents <= 0) return "You have no balance due right now";
  if (amountCents > balanceCents) return `The most you can pay right now is ${formatCents(balanceCents)}`;
  if (amountCents < balanceCents) {
    if (!policy.allowPartialPayments) return `Please pay the full balance of ${formatCents(balanceCents)}`;
    if (amountCents < policy.minPartialPaymentCents)
      return `Partial payments must be at least ${formatCents(policy.minPartialPaymentCents)}`;
  }
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
