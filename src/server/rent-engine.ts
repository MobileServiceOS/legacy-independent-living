/**
 * Rent engine runner. Posts due rent charges + late fees and sends reminders.
 * Safe to run any number of times (idempotency keys + dedupe keys).
 * Triggered by: POST /api/cron/rent (daily cron), the admin "Run now" button,
 * resident conversion, and lazily once per business day on dashboard loads.
 */
import { formatLong, type DateOnly } from "../domain/dates";
import { formatCents } from "../domain/money";
import { deriveRentPosition, planLateFees, planRentCharges } from "../domain/rent";
import { audit, AUDIT_ACTIONS, SYSTEM_ACTOR, type Actor } from "../lib/audit";
import { prisma, type Db } from "../lib/db";
import { notify } from "../lib/notify";
import { businessToday, getSettings, rentSettingsOf } from "../lib/settings";
import { pendingPaymentCents, postLedgerEntry, toLine, toScheduleInput } from "./ledger";

export interface RentRunResult {
  today: DateOnly;
  chargesPosted: number;
  lateFeesPosted: number;
  remindersSent: number;
  failures: number;
}

async function postForResident(db: Db, residentId: string, today: DateOnly, settings: ReturnType<typeof rentSettingsOf>) {
  let charges = 0;
  let fees = 0;
  const schedules = await db.rentSchedule.findMany({ where: { residentId }, orderBy: { startDate: "asc" } });
  for (const s of schedules) {
    for (const plan of planRentCharges(toScheduleInput(s), today, settings)) {
      const exists = await db.ledgerEntry.findUnique({ where: { idempotencyKey: plan.idempotencyKey }, select: { id: true } });
      if (exists) continue;
      await postLedgerEntry(db, null, {
        residentId,
        type: "RENT_CHARGE",
        amountCents: plan.amountCents,
        description: plan.description,
        effectiveDate: plan.effectiveDate,
        dueDate: plan.dueDate,
        rentScheduleId: plan.scheduleId,
        idempotencyKey: plan.idempotencyKey,
      });
      charges++;
    }
  }
  if (settings.lateFeeCents > 0) {
    const entries = await db.ledgerEntry.findMany({ where: { residentId } });
    for (const fee of planLateFees(entries.map(toLine), today, settings)) {
      const exists = await db.ledgerEntry.findUnique({ where: { idempotencyKey: fee.idempotencyKey }, select: { id: true } });
      if (exists) continue;
      await postLedgerEntry(db, null, {
        residentId,
        type: "LATE_FEE",
        amountCents: fee.amountCents,
        description: fee.description,
        effectiveDate: fee.effectiveDate,
        dueDate: fee.dueDate,
        relatedEntryId: fee.chargeId,
        idempotencyKey: fee.idempotencyKey,
      });
      fees++;
    }
  }
  return { charges, fees };
}

async function remindResident(db: Db, residentId: string, userId: string, today: DateOnly): Promise<number> {
  const entries = await db.ledgerEntry.findMany({ where: { residentId } });
  const position = deriveRentPosition({
    lines: entries.map(toLine),
    today,
    pendingCents: await pendingPaymentCents(db, residentId),
  });
  const due = position.nextDueDate;
  if (!due) return 0;
  const amount = formatCents(position.balanceCents);
  const base = { userId, link: "/home" };
  switch (position.status) {
    case "DUE_SOON":
      return (await notify(db, {
        ...base,
        type: "RENT_DUE_SOON",
        title: "Rent due soon",
        body: `Your rent of ${amount} is due ${formatLong(due)}.`,
        dedupeKey: `rent-due-soon:${residentId}:${due}`,
      }))
        ? 1
        : 0;
    case "DUE":
      return (await notify(db, {
        ...base,
        type: "RENT_DUE_TODAY",
        title: "Rent is due today",
        body: `Your balance of ${amount} is due today.`,
        dedupeKey: `rent-due-today:${residentId}:${due}`,
      }))
        ? 1
        : 0;
    case "OVERDUE":
      return (await notify(db, {
        ...base,
        type: "RENT_OVERDUE",
        title: "Rent is overdue",
        body: `Your balance of ${amount} was due ${formatLong(due)}. Please pay as soon as you can or contact the office.`,
        dedupeKey: `rent-overdue:${residentId}:${due}`,
      }))
        ? 1
        : 0;
    default:
      return 0;
  }
}

/** Post charges for a single resident right away (e.g. right after conversion). */
export async function runRentEngineForResident(db: Db, residentId: string, today?: DateOnly) {
  const settings = await getSettings(db);
  return postForResident(db, residentId, today ?? businessToday(settings), rentSettingsOf(settings));
}

export async function runRentEngine(opts: { today?: DateOnly; actor?: Actor; sendReminders?: boolean } = {}): Promise<RentRunResult> {
  const settings = await getSettings();
  const today = opts.today ?? businessToday(settings);
  const rs = rentSettingsOf(settings);
  const residents = await prisma.resident.findMany({
    where: { rentSchedules: { some: {} } },
    select: { id: true, status: true, userId: true, user: { select: { status: true } } },
  });

  let chargesPosted = 0;
  let lateFeesPosted = 0;
  let remindersSent = 0;
  let failures = 0;
  for (const r of residents) {
    // Each resident in its own transaction (row-locked so concurrent runs serialize):
    // one bad record can't block everyone else's rent.
    try {
      const res = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM residents WHERE id = ${r.id} FOR UPDATE`;
        const posted = await postForResident(tx, r.id, today, rs);
        let reminders = 0;
        if (opts.sendReminders !== false && r.status === "ACTIVE" && r.userId && r.user?.status !== "DISABLED") {
          reminders = await remindResident(tx, r.id, r.userId, today);
        }
        return { ...posted, reminders };
      });
      chargesPosted += res.charges;
      lateFeesPosted += res.fees;
      remindersSent += res.reminders;
    } catch (err) {
      failures++;
      console.error(`[rent-engine] resident ${r.id} failed`, err);
    }
  }

  if (chargesPosted + lateFeesPosted + failures > 0 || opts.actor) {
    await audit(prisma, opts.actor ?? SYSTEM_ACTOR, AUDIT_ACTIONS.rentEngineRun, "rent_engine", null, {
      today,
      chargesPosted,
      lateFeesPosted,
      remindersSent,
      failures,
    });
  }
  return { today, chargesPosted, lateFeesPosted, remindersSent, failures };
}

const g = globalThis as unknown as { __lilRentRanFor?: string; __lilRentRunning?: Promise<unknown> };

/** Run at most once per business day per server process (cheap guard for page loads). */
export async function ensureRentEngineCurrent(): Promise<void> {
  const settings = await getSettings();
  const today = businessToday(settings);
  if (g.__lilRentRanFor === today) return;
  if (!g.__lilRentRunning) {
    g.__lilRentRunning = runRentEngine({ today })
      .then(() => {
        g.__lilRentRanFor = today;
      })
      .catch((err) => console.error("[rent-engine] lazy run failed", err))
      .finally(() => {
        g.__lilRentRunning = undefined;
      });
  }
  await g.__lilRentRunning;
}
