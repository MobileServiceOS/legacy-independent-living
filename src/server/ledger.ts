import { Prisma, type LedgerEntry, type LedgerEntryType } from "@prisma/client";
import { dateOnlyFromDbDate, dbDateFromDateOnly, type DateOnly } from "../domain/dates";
import { validateLedgerAmount, type LedgerLine } from "../domain/ledger";
import { deriveRentPosition, type RentPosition, type RentScheduleInput } from "../domain/rent";
import type { Actor } from "../lib/audit";
import type { Db } from "../lib/db";
import { UserError } from "./errors";

export function toLine(e: Pick<LedgerEntry, "id" | "type" | "amountCents" | "effectiveDate" | "dueDate" | "createdAt">): LedgerLine {
  return {
    id: e.id,
    type: e.type,
    amountCents: e.amountCents,
    effectiveDate: dateOnlyFromDbDate(e.effectiveDate),
    dueDate: e.dueDate ? dateOnlyFromDbDate(e.dueDate) : null,
    createdAt: e.createdAt,
  };
}

export interface PostEntryInput {
  residentId: string;
  type: LedgerEntryType;
  amountCents: number;
  description: string;
  effectiveDate: DateOnly;
  dueDate?: DateOnly | null;
  paymentId?: string | null;
  rentScheduleId?: string | null;
  relatedEntryId?: string | null;
  idempotencyKey?: string | null;
}

/**
 * The ONLY way application code writes to the ledger. Validates sign rules
 * (the DB re-checks them) and is idempotent when an idempotencyKey is given.
 */
export async function postLedgerEntry(db: Db, actor: Actor | null, input: PostEntryInput): Promise<LedgerEntry> {
  const problem = validateLedgerAmount(input.type, input.amountCents);
  if (problem) throw new UserError(problem);
  if (input.idempotencyKey) {
    const existing = await db.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
  }
  try {
    return await db.ledgerEntry.create({
      data: {
        residentId: input.residentId,
        type: input.type,
        amountCents: input.amountCents,
        description: input.description,
        effectiveDate: dbDateFromDateOnly(input.effectiveDate),
        dueDate: input.dueDate ? dbDateFromDateOnly(input.dueDate) : null,
        paymentId: input.paymentId ?? null,
        rentScheduleId: input.rentScheduleId ?? null,
        relatedEntryId: input.relatedEntryId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdById: actor && actor.role !== "SYSTEM" ? actor.id : null,
      },
    });
  } catch (err) {
    // Only recoverable outside a transaction (inside one, Postgres has aborted it and the
    // caller's transaction rolls back — callers lock the resident/payment row to avoid this).
    if (input.idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && "$transaction" in db) {
      const existing = await db.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }
    throw err;
  }
}

export function toScheduleInput(s: {
  id: string;
  residentId: string;
  monthlyRentCents: number;
  dueDay: number;
  startDate: Date;
  endDate: Date | null;
}): RentScheduleInput {
  return {
    id: s.id,
    residentId: s.residentId,
    monthlyRentCents: s.monthlyRentCents,
    dueDay: s.dueDay,
    startDate: dateOnlyFromDbDate(s.startDate),
    endDate: s.endDate ? dateOnlyFromDbDate(s.endDate) : null,
  };
}

export async function activeSchedule(db: Db, residentId: string) {
  return db.rentSchedule.findFirst({ where: { residentId, endDate: null }, orderBy: { startDate: "desc" } });
}

/** Money in flight (ACH processing) — shown as pending, not yet in the ledger. */
export async function pendingPaymentCents(db: Db, residentId: string): Promise<number> {
  const agg = await db.payment.aggregate({ where: { residentId, status: "PROCESSING" }, _sum: { amountCents: true } });
  return agg._sum.amountCents ?? 0;
}

export interface ResidentFinancials {
  position: RentPosition;
  lines: LedgerLine[];
  schedule: RentScheduleInput | null;
  totalPaidCents: number;
}

export async function residentFinancials(db: Db, residentId: string, today: DateOnly): Promise<ResidentFinancials> {
  const [entries, schedule, pendingCents] = await Promise.all([
    db.ledgerEntry.findMany({ where: { residentId }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] }),
    activeSchedule(db, residentId),
    pendingPaymentCents(db, residentId),
  ]);
  const lines = entries.map(toLine);
  const scheduleInput = schedule ? toScheduleInput(schedule) : null;
  const totalPaidCents = entries
    .filter((e) => e.type === "PAYMENT")
    .reduce((s, e) => s - e.amountCents, 0) - entries.filter((e) => e.type === "REFUND").reduce((s, e) => s + e.amountCents, 0);
  return {
    position: deriveRentPosition({ lines, today, pendingCents, schedule: scheduleInput }),
    lines,
    schedule: scheduleInput,
    totalPaidCents,
  };
}
