import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allocate, balanceOf, validateLedgerAmount, withRunningBalance, type LedgerLine } from "../../src/domain/ledger.ts";
import {
  deriveRentPosition,
  nextScheduledDueDate,
  planLateFees,
  planRentCharges,
  type RentScheduleInput,
} from "../../src/domain/rent.ts";
import { collectionMetrics } from "../../src/domain/reports.ts";

let seq = 0;
const line = (type: LedgerLine["type"], amountCents: number, effectiveDate: string, dueDate?: string): LedgerLine => ({
  id: `e${++seq}`,
  type,
  amountCents,
  effectiveDate,
  dueDate: dueDate ?? null,
});

const schedule: RentScheduleInput = {
  id: "s1",
  residentId: "r1",
  monthlyRentCents: 75000,
  dueDay: 1,
  startDate: "2026-10-01",
};

describe("ledger", () => {
  test("sign rules per entry type", () => {
    assert.equal(validateLedgerAmount("RENT_CHARGE", 75000), null);
    assert.match(validateLedgerAmount("RENT_CHARGE", -1)!, /positive/);
    assert.equal(validateLedgerAmount("PAYMENT", -75000), null);
    assert.match(validateLedgerAmount("PAYMENT", 75000)!, /negative/);
    assert.match(validateLedgerAmount("CREDIT", 10)!, /negative/);
    assert.equal(validateLedgerAmount("ADJUSTMENT", -10), null);
    assert.equal(validateLedgerAmount("ADJUSTMENT", 10), null);
    assert.match(validateLedgerAmount("ADJUSTMENT", 0)!, /zero/);
    assert.match(validateLedgerAmount("LATE_FEE", 1.5)!, /integer/);
  });

  test("spec example: $750 rent then $750 ACH → balance $0", () => {
    const lines = [line("RENT_CHARGE", 75000, "2026-10-01"), line("PAYMENT", -75000, "2026-10-01")];
    assert.equal(balanceOf(lines), 0);
    const running = withRunningBalance(lines);
    assert.deepEqual(
      running.map((r) => r.runningBalanceCents),
      [75000, 0],
    );
  });

  test("FIFO allocation pays oldest charge first", () => {
    const lines = [
      line("RENT_CHARGE", 75000, "2026-09-01"),
      line("RENT_CHARGE", 75000, "2026-10-01"),
      line("PAYMENT", -100000, "2026-10-02"),
    ];
    const a = allocate(lines);
    assert.equal(a.charges[0]!.remainingCents, 0);
    assert.equal(a.charges[1]!.paidCents, 25000);
    assert.equal(a.charges[1]!.remainingCents, 50000);
    assert.equal(a.balanceCents, 50000);
  });

  test("overpayment leaves unapplied credit and negative balance", () => {
    const a = allocate([line("RENT_CHARGE", 75000, "2026-10-01"), line("PAYMENT", -80000, "2026-10-01")]);
    assert.equal(a.unappliedCreditCents, 5000);
    assert.equal(a.balanceCents, -5000);
  });

  test("refund re-opens balance", () => {
    const lines = [
      line("RENT_CHARGE", 75000, "2026-10-01"),
      line("PAYMENT", -75000, "2026-10-01"),
      line("REFUND", 75000, "2026-10-05"),
    ];
    assert.equal(balanceOf(lines), 75000);
    assert.equal(allocate(lines).charges.find((c) => c.type === "REFUND")!.remainingCents, 75000);
  });
});

describe("rent charge planning", () => {
  test("success scenario: Oct 1 move-in, viewed Sept 27 → Oct charge already posted", () => {
    const planned = planRentCharges(schedule, "2026-09-27", { chargeLeadDays: 7 });
    assert.equal(planned.length, 1);
    assert.deepEqual(
      { key: planned[0]!.idempotencyKey, due: planned[0]!.dueDate, amt: planned[0]!.amountCents, eff: planned[0]!.effectiveDate },
      { key: "rent:r1:2026-10", due: "2026-10-01", amt: 75000, eff: "2026-10-01" },
    );
  });

  test("not posted before the lead window", () => {
    assert.equal(planRentCharges(schedule, "2026-09-20", { chargeLeadDays: 7 }).length, 0);
  });

  test("backfills every month up to the horizon; keys are per resident-month", () => {
    const planned = planRentCharges(schedule, "2027-01-26", { chargeLeadDays: 7 });
    assert.deepEqual(
      planned.map((p) => p.period),
      ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"],
    );
    assert.equal(new Set(planned.map((p) => p.idempotencyKey)).size, planned.length);
  });

  test("mid-month move-in: first due date is move-in date, then due day", () => {
    const s = { ...schedule, startDate: "2026-10-15" };
    const planned = planRentCharges(s, "2026-11-01", { chargeLeadDays: 0 });
    assert.deepEqual(
      planned.map((p) => p.dueDate),
      ["2026-10-15", "2026-11-01"],
    );
  });

  test("due day 31 clamps in short months", () => {
    const s = { ...schedule, dueDay: 31, startDate: "2027-01-31" };
    assert.deepEqual(
      planRentCharges(s, "2027-03-01", { chargeLeadDays: 0 }).map((p) => p.dueDate),
      ["2027-01-31", "2027-02-28"],
    );
  });

  test("stops at schedule end date (move-out / rent change)", () => {
    const s = { ...schedule, endDate: "2026-11-15" };
    assert.deepEqual(
      planRentCharges(s, "2027-02-01", { chargeLeadDays: 7 }).map((p) => p.period),
      ["2026-10", "2026-11"],
    );
  });

  test("nextScheduledDueDate", () => {
    assert.equal(nextScheduledDueDate(schedule, "2026-09-27"), "2026-10-01");
    assert.equal(nextScheduledDueDate(schedule, "2026-10-02"), "2026-11-01");
    assert.equal(nextScheduledDueDate({ ...schedule, endDate: "2026-10-20" }, "2026-10-02"), null);
  });
});

describe("rent status derivation", () => {
  const charge = line("RENT_CHARGE", 75000, "2026-10-01", "2026-10-01");

  test("DUE_SOON before due date", () => {
    const p = deriveRentPosition({ lines: [charge], today: "2026-09-27" });
    assert.equal(p.status, "DUE_SOON");
    assert.equal(p.balanceCents, 75000);
    assert.equal(p.nextDueDate, "2026-10-01");
    assert.equal(p.pastDueCents, 0);
  });

  test("DUE on the due date", () => {
    assert.equal(deriveRentPosition({ lines: [charge], today: "2026-10-01" }).status, "DUE");
  });

  test("OVERDUE the day after, with days overdue", () => {
    const p = deriveRentPosition({ lines: [charge], today: "2026-10-04" });
    assert.equal(p.status, "OVERDUE");
    assert.equal(p.daysOverdue, 3);
    assert.equal(p.pastDueCents, 75000);
  });

  test("PARTIAL when some of the current charge is paid", () => {
    const p = deriveRentPosition({ lines: [charge, line("PAYMENT", -30000, "2026-09-28")], today: "2026-09-29" });
    assert.equal(p.status, "PARTIAL");
    assert.equal(p.balanceCents, 45000);
  });

  test("OVERDUE beats PARTIAL once the due date passes", () => {
    const p = deriveRentPosition({ lines: [charge, line("PAYMENT", -30000, "2026-09-28")], today: "2026-10-05" });
    assert.equal(p.status, "OVERDUE");
  });

  test("PENDING when an in-flight ACH covers the balance", () => {
    const p = deriveRentPosition({ lines: [charge], today: "2026-10-03", pendingCents: 75000 });
    assert.equal(p.status, "PENDING");
  });

  test("PAID when balance is zero; next due comes from the schedule", () => {
    const p = deriveRentPosition({
      lines: [charge, line("PAYMENT", -75000, "2026-09-30")],
      today: "2026-10-01",
      schedule,
    });
    assert.equal(p.status, "PAID");
    assert.equal(p.balanceCents, 0);
    assert.equal(p.nextDueDate, "2026-11-01");
  });

  test("PAID after paying next month early → next due is the month after", () => {
    const p = deriveRentPosition({
      lines: [charge, line("PAYMENT", -75000, "2026-09-27")],
      today: "2026-09-27",
      schedule,
    });
    assert.equal(p.status, "PAID");
    assert.equal(p.nextDueDate, "2026-11-01");
  });

  test("PAID with nothing posted yet → next scheduled due date", () => {
    const p = deriveRentPosition({ lines: [], today: "2026-09-10", schedule });
    assert.equal(p.status, "PAID");
    assert.equal(p.nextDueDate, "2026-10-01");
  });

  test("PAID with credit", () => {
    const p = deriveRentPosition({ lines: [charge, line("PAYMENT", -80000, "2026-09-30")], today: "2026-10-01" });
    assert.equal(p.status, "PAID");
    assert.equal(p.creditCents, 5000);
  });
});

describe("late fees", () => {
  const charge = { ...line("RENT_CHARGE", 75000, "2026-10-01", "2026-10-01"), id: "c-oct" };

  test("none within grace period or when disabled", () => {
    assert.equal(planLateFees([charge], "2026-10-06", { graceDays: 5, lateFeeCents: 5000 }).length, 0);
    assert.equal(planLateFees([charge], "2026-10-20", { graceDays: 5, lateFeeCents: 0 }).length, 0);
  });

  test("one idempotent fee per unpaid rent charge after grace", () => {
    const fees = planLateFees([charge], "2026-10-07", { graceDays: 5, lateFeeCents: 5000 });
    assert.equal(fees.length, 1);
    assert.equal(fees[0]!.idempotencyKey, "late:c-oct");
    assert.equal(fees[0]!.effectiveDate, "2026-10-07");
  });

  test("no fee when rent was paid", () => {
    const fees = planLateFees([charge, line("PAYMENT", -75000, "2026-10-01")], "2026-10-20", {
      graceDays: 5,
      lateFeeCents: 5000,
    });
    assert.equal(fees.length, 0);
  });
});

describe("collection metrics", () => {
  test("spec dashboard math", () => {
    const ledgers = [
      { lines: [line("RENT_CHARGE", 75000, "2026-10-01", "2026-10-01"), line("PAYMENT", -75000, "2026-10-01")] },
      { lines: [line("RENT_CHARGE", 75000, "2026-10-01", "2026-10-01"), line("PAYMENT", -25000, "2026-10-02")] },
      { lines: [line("RENT_CHARGE", 70000, "2026-09-01", "2026-09-01"), line("RENT_CHARGE", 70000, "2026-10-01", "2026-10-01")] },
    ];
    const m = collectionMetrics(ledgers, "2026-10", "2026-10-10");
    assert.equal(m.expectedCents, 220000);
    assert.equal(m.collectedCents, 100000);
    assert.equal(m.outstandingCents, 120000);
    assert.equal(m.overdueCents, 50000 + 70000 + 70000);
    assert.equal(m.collectionRate, 45.5);
  });
});
