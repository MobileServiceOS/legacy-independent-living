/**
 * Rent engine — pure functions. The database layer asks this module WHAT should
 * exist (charges, late fees, statuses); it never decides on its own.
 *
 * Idempotency: every generated charge carries a deterministic key
 *   rent:<residentId>:<YYYY-MM>   one rent charge per resident per month
 *   late:<chargeId>               one late fee per rent charge
 * backed by a UNIQUE index, so running the engine twice can never double-bill.
 */
import { addDays, addMonths, diffDays, dueDateFor, maxDate, monthKey, parseDateOnly, type DateOnly } from "./dates.ts";
import { allocate, type LedgerLine } from "./ledger.ts";
import type { Cents } from "./money.ts";

export interface RentSettings {
  /**
   * Days before the due date that a charge is posted. A posted-but-not-yet-due
   * charge shows as "Due soon", so this is also the "due soon" window.
   */
  chargeLeadDays: number;
  /** Days after the due date before a late fee is assessed (0 = the next day). */
  graceDays: number;
  /** 0 disables late fees. */
  lateFeeCents: Cents;
}

export const DEFAULT_RENT_SETTINGS: RentSettings = {
  chargeLeadDays: 7,
  graceDays: 5,
  lateFeeCents: 0,
};

export interface RentScheduleInput {
  id: string;
  residentId: string;
  monthlyRentCents: Cents;
  /** 1–28 recommended; 29–31 are clamped to the month's last day. */
  dueDay: number;
  startDate: DateOnly;
  endDate?: DateOnly | null;
}

export interface PlannedRentCharge {
  idempotencyKey: string;
  scheduleId: string;
  residentId: string;
  period: string; // YYYY-MM
  dueDate: DateOnly;
  effectiveDate: DateOnly;
  amountCents: Cents;
  description: string;
}

export const rentKey = (residentId: string, period: string) => `rent:${residentId}:${period}`;
export const lateFeeKey = (chargeId: string) => `late:${chargeId}`;

const MAX_BACKFILL_MONTHS = 24;

/**
 * Charges that SHOULD exist for a schedule as of `today`. Includes every period
 * from the schedule start whose due date is within `chargeLeadDays` of today.
 * The first period's due date never precedes the move-in date.
 */
export function planRentCharges(
  schedule: RentScheduleInput,
  today: DateOnly,
  settings: Pick<RentSettings, "chargeLeadDays">,
): PlannedRentCharge[] {
  if (schedule.monthlyRentCents <= 0) return [];
  if (schedule.dueDay < 1 || schedule.dueDay > 31) throw new Error("dueDay must be 1–31");
  const horizon = addDays(today, settings.chargeLeadDays);
  const start = parseDateOnly(schedule.startDate);
  const out: PlannedRentCharge[] = [];

  for (let i = 0; i < MAX_BACKFILL_MONTHS + 2; i++) {
    const { y, m } = addMonths(start.y, start.m, i);
    const nominalDue = dueDateFor(y, m, schedule.dueDay);
    const dueDate = i === 0 ? maxDate(nominalDue, schedule.startDate) : nominalDue;
    if (dueDate > horizon) break;
    if (schedule.endDate && dueDate > schedule.endDate) break;
    const period = monthKey(dueDate);
    out.push({
      idempotencyKey: rentKey(schedule.residentId, period),
      scheduleId: schedule.id,
      residentId: schedule.residentId,
      period,
      dueDate,
      // Posted up to chargeLeadDays early, but dated on the due date so the ledger reads "Oct 1 — Monthly rent".
      effectiveDate: dueDate,
      amountCents: schedule.monthlyRentCents,
      description: `Monthly rent — ${period}`,
    });
  }
  // keep only the most recent MAX_BACKFILL_MONTHS periods as a safety valve
  return out.slice(-MAX_BACKFILL_MONTHS);
}

export interface PlannedLateFee {
  idempotencyKey: string;
  chargeId: string;
  amountCents: Cents;
  effectiveDate: DateOnly;
  dueDate: DateOnly;
  description: string;
}

/** Late fees for rent charges still unpaid after the grace period. */
export function planLateFees(
  lines: readonly LedgerLine[],
  today: DateOnly,
  settings: Pick<RentSettings, "graceDays" | "lateFeeCents">,
): PlannedLateFee[] {
  if (settings.lateFeeCents <= 0) return [];
  const { charges } = allocate(lines);
  return charges
    .filter((c) => c.type === "RENT_CHARGE" && c.remainingCents > 0 && diffDays(today, c.dueDate) > settings.graceDays)
    .map((c) => {
      const assessed = addDays(c.dueDate, settings.graceDays + 1);
      return {
        idempotencyKey: lateFeeKey(c.id),
        chargeId: c.id,
        amountCents: settings.lateFeeCents,
        effectiveDate: assessed,
        dueDate: assessed,
        description: `Late fee — rent due ${c.dueDate}`,
      };
    });
}

/** Next scheduled due date on/after `today` for a schedule (ignores the ledger). */
export function nextScheduledDueDate(schedule: RentScheduleInput, today: DateOnly): DateOnly | null {
  const from = maxDate(today, schedule.startDate);
  const { y, m } = parseDateOnly(from);
  for (let i = 0; i < 3; i++) {
    const ym = addMonths(y, m, i);
    let due = dueDateFor(ym.y, ym.m, schedule.dueDay);
    if (i === 0 && monthKey(schedule.startDate) === monthKey(due)) due = maxDate(due, schedule.startDate);
    if (due >= from) {
      if (schedule.endDate && due > schedule.endDate) return null;
      return due;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

export const RENT_STATUSES = ["PAID", "DUE_SOON", "DUE", "OVERDUE", "PARTIAL", "PENDING"] as const;
export type RentStatus = (typeof RENT_STATUSES)[number];

export const RENT_STATUS_LABELS: Record<RentStatus, string> = {
  PAID: "Paid",
  DUE_SOON: "Due soon",
  DUE: "Due today",
  OVERDUE: "Overdue",
  PARTIAL: "Partially paid",
  PENDING: "Payment pending",
};

export interface RentPosition {
  status: RentStatus;
  balanceCents: Cents;
  /** Amount on charges already due (due date <= today). */
  pastDueCents: Cents;
  /** Oldest unpaid due date, or the next scheduled due date when fully paid. */
  nextDueDate: DateOnly | null;
  daysOverdue: number;
  pendingCents: Cents;
  creditCents: Cents;
}

/**
 * Status is derived ONLY from the ledger + in-flight payments + schedule.
 * Precedence: PAID → PENDING → OVERDUE → PARTIAL → DUE → DUE_SOON.
 */
export function deriveRentPosition(input: {
  lines: readonly LedgerLine[];
  today: DateOnly;
  /** Sum of payments in PENDING/PROCESSING state (e.g. ACH in flight). */
  pendingCents?: Cents;
  schedule?: RentScheduleInput | null;
}): RentPosition {
  const { lines, today } = input;
  const pendingCents = input.pendingCents ?? 0;
  const allocation = allocate(lines);
  const open = allocation.charges.filter((c) => c.remainingCents > 0);
  const pastDueCents = open.filter((c) => c.dueDate <= today).reduce((s, c) => s + c.remainingCents, 0);
  const balanceCents = allocation.balanceCents;

  if (balanceCents <= 0 || open.length === 0) {
    // Next due = first scheduled date after today AND after any rent already posted (paid early).
    let from = addDays(today, 1);
    for (const l of lines) {
      const due = l.dueDate ?? l.effectiveDate;
      if (l.type === "RENT_CHARGE" && due >= from) from = addDays(due, 1);
    }
    return {
      status: "PAID",
      balanceCents,
      pastDueCents: 0,
      nextDueDate: input.schedule ? nextScheduledDueDate(input.schedule, from) : null,
      daysOverdue: 0,
      pendingCents,
      creditCents: balanceCents < 0 ? -balanceCents : allocation.unappliedCreditCents,
    };
  }

  const oldest = open[0]!;
  const daysPast = diffDays(today, oldest.dueDate);
  const base = {
    balanceCents,
    pastDueCents,
    nextDueDate: oldest.dueDate,
    daysOverdue: Math.max(0, daysPast),
    pendingCents,
    creditCents: 0,
  };

  if (pendingCents >= balanceCents) return { status: "PENDING", ...base };
  if (daysPast > 0) return { status: "OVERDUE", ...base };
  if (oldest.paidCents > 0) return { status: "PARTIAL", ...base };
  if (daysPast === 0) return { status: "DUE", ...base };
  // Charges are only posted chargeLeadDays ahead, so any open future charge is "due soon".
  return { status: "DUE_SOON", ...base };
}
