/**
 * Resident ledger — the single source of financial truth.
 *
 * Sign convention (from the resident's perspective, i.e. what they owe):
 *   positive amount = increases what the resident owes (rent, fees, refunds paid back out)
 *   negative amount = reduces what the resident owes (payments, credits)
 *
 * Balance is ALWAYS the sum of entries. There is no stored balance field.
 * Entries are append-only; mistakes are corrected with ADJUSTMENT entries.
 */
import { assertCents, type Cents } from "./money.ts";
import type { DateOnly } from "./dates.ts";

export const LEDGER_ENTRY_TYPES = [
  "RENT_CHARGE",
  "PAYMENT",
  "LATE_FEE",
  "OTHER_CHARGE",
  "CREDIT",
  "ADJUSTMENT",
  "REFUND",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = {
  RENT_CHARGE: "Monthly rent",
  PAYMENT: "Payment",
  LATE_FEE: "Late fee",
  OTHER_CHARGE: "Charge",
  CREDIT: "Credit",
  ADJUSTMENT: "Adjustment",
  REFUND: "Refund",
};

/** Types that must be positive (increase balance). */
const POSITIVE_ONLY: ReadonlySet<LedgerEntryType> = new Set(["RENT_CHARGE", "LATE_FEE", "OTHER_CHARGE", "REFUND"]);
/** Types that must be negative (decrease balance). */
const NEGATIVE_ONLY: ReadonlySet<LedgerEntryType> = new Set(["PAYMENT", "CREDIT"]);

export function isLedgerEntryType(value: unknown): value is LedgerEntryType {
  return typeof value === "string" && (LEDGER_ENTRY_TYPES as readonly string[]).includes(value);
}

/** Returns an error message, or null when the signed amount is valid for the type. */
export function validateLedgerAmount(type: LedgerEntryType, amountCents: Cents): string | null {
  try {
    assertCents(amountCents);
  } catch (err) {
    return (err as Error).message;
  }
  if (amountCents === 0) return "Amount cannot be zero";
  if (POSITIVE_ONLY.has(type) && amountCents < 0) return `${LEDGER_TYPE_LABELS[type]} must be a positive amount`;
  if (NEGATIVE_ONLY.has(type) && amountCents > 0) return `${LEDGER_TYPE_LABELS[type]} must be a negative amount`;
  return null;
}

export interface LedgerLine {
  id: string;
  type: LedgerEntryType;
  amountCents: Cents;
  effectiveDate: DateOnly;
  /** For charges: the date payment is due. Defaults to effectiveDate. */
  dueDate?: DateOnly | null;
  createdAt?: Date | string;
}

export function balanceOf(lines: readonly LedgerLine[]): Cents {
  let total = 0;
  for (const line of lines) total += line.amountCents;
  assertCents(total, "balance");
  return total;
}

export interface AllocatedCharge {
  id: string;
  type: LedgerEntryType;
  dueDate: DateOnly;
  amountCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
}

export interface Allocation {
  charges: AllocatedCharge[];
  /** Credit left over after paying every debit (resident is ahead). */
  unappliedCreditCents: Cents;
  balanceCents: Cents;
}

function sortKey(line: LedgerLine): string {
  const created = line.createdAt ? new Date(line.createdAt).toISOString() : "";
  return `${line.dueDate ?? line.effectiveDate}|${line.effectiveDate}|${created}|${line.id}`;
}

/**
 * FIFO allocation: every credit (payment, credit, negative adjustment) pays down
 * the oldest-due debit first. This is what lets us say *which* charge is
 * overdue or partially paid, derived purely from the ledger.
 */
export function allocate(lines: readonly LedgerLine[]): Allocation {
  const debits = lines.filter((l) => l.amountCents > 0).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  let pool = 0;
  for (const l of lines) if (l.amountCents < 0) pool += -l.amountCents;

  const charges: AllocatedCharge[] = debits.map((d) => {
    const paid = Math.min(pool, d.amountCents);
    pool -= paid;
    return {
      id: d.id,
      type: d.type,
      dueDate: d.dueDate ?? d.effectiveDate,
      amountCents: d.amountCents,
      paidCents: paid,
      remainingCents: d.amountCents - paid,
    };
  });

  return { charges, unappliedCreditCents: pool, balanceCents: balanceOf(lines) };
}

/** Running balance for display (oldest → newest). */
export function withRunningBalance<T extends LedgerLine>(lines: readonly T[]): Array<T & { runningBalanceCents: Cents }> {
  const ordered = [...lines].sort((a, b) => {
    const ka = `${a.effectiveDate}|${a.createdAt ? new Date(a.createdAt).toISOString() : ""}|${a.id}`;
    const kb = `${b.effectiveDate}|${b.createdAt ? new Date(b.createdAt).toISOString() : ""}|${b.id}`;
    return ka < kb ? -1 : 1;
  });
  let running = 0;
  return ordered.map((l) => {
    running += l.amountCents;
    return { ...l, runningBalanceCents: running };
  });
}
