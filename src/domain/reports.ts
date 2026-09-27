/** Rent collection metrics, derived from ledgers (never from stored totals). */
import { monthBounds, type DateOnly } from "./dates.ts";
import { allocate, type LedgerLine } from "./ledger.ts";
import { percent, type Cents } from "./money.ts";

export interface CollectionMetrics {
  /** Rent charges due within the month. */
  expectedCents: Cents;
  /** Portion of those charges that has been paid (FIFO allocation). */
  collectedCents: Cents;
  /** expected − collected. */
  outstandingCents: Cents;
  /** Remaining on ANY charge whose due date is before today. */
  overdueCents: Cents;
  collectionRate: number;
}

export function collectionMetrics(
  ledgers: ReadonlyArray<{ lines: readonly LedgerLine[] }>,
  month: string,
  today: DateOnly,
): CollectionMetrics {
  const { start, end } = monthBounds(month);
  let expected = 0;
  let collected = 0;
  let overdue = 0;
  for (const { lines } of ledgers) {
    for (const c of allocate(lines).charges) {
      if (c.type === "RENT_CHARGE" && c.dueDate >= start && c.dueDate <= end) {
        expected += c.amountCents;
        collected += c.paidCents;
      }
      if (c.dueDate < today) overdue += c.remainingCents;
    }
  }
  return {
    expectedCents: expected,
    collectedCents: collected,
    outstandingCents: expected - collected,
    overdueCents: overdue,
    collectionRate: percent(collected, expected),
  };
}
