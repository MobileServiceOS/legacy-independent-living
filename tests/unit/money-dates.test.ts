import { test } from "node:test";
import assert from "node:assert/strict";
import { centsToInput, formatCents, parseDollarsToCents, percent, sumCents } from "../../src/domain/money.ts";
import {
  addDays,
  addMonths,
  dateOnlyFromDbDate,
  dbDateFromDateOnly,
  diffDays,
  dueDateFor,
  formatLong,
  formatMonth,
  isDateOnly,
  monthBounds,
  todayIn,
} from "../../src/domain/dates.ts";

test("parseDollarsToCents: accepts common formats without float error", () => {
  assert.equal(parseDollarsToCents("750"), 75000);
  assert.equal(parseDollarsToCents("750.5"), 75050);
  assert.equal(parseDollarsToCents("750.50"), 75050);
  assert.equal(parseDollarsToCents("$1,250.00"), 125000);
  assert.equal(parseDollarsToCents(" 0.10 "), 10);
  assert.equal(parseDollarsToCents("0.29"), 29); // 0.29*100 = 28.999… in float math
  assert.equal(parseDollarsToCents("1.005"), null);
});

test("parseDollarsToCents: rejects negatives, junk, bad grouping", () => {
  for (const bad of ["", "-5", "abc", "1,25", "12.", ".5", "1e3", "$", "12,34,567"]) {
    assert.equal(parseDollarsToCents(bad), null, bad);
  }
});

test("formatCents / centsToInput", () => {
  assert.equal(formatCents(75000), "$750.00");
  assert.equal(formatCents(1860000), "$18,600.00");
  assert.equal(formatCents(-2500), "-$25.00");
  assert.equal(formatCents(5, { signed: true }), "+$0.05");
  assert.equal(centsToInput(75050), "750.50");
  assert.throws(() => formatCents(1.5));
});

test("sumCents guards non-integers; percent handles zero", () => {
  assert.equal(sumCents([75000, -75000, 100]), 100);
  assert.throws(() => sumCents([0.1, 0.2]));
  assert.equal(percent(32, 36), 88.9);
  assert.equal(percent(1, 0), 0);
});

test("dates: arithmetic across month/year/leap boundaries", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(diffDays("2026-10-03", "2026-10-01"), 2);
  assert.equal(diffDays("2026-10-01", "2026-10-03"), -2);
  assert.deepEqual(addMonths(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(addMonths(2026, 1, -1), { y: 2025, m: 12 });
  assert.equal(dueDateFor(2026, 2, 31), "2026-02-28");
  assert.equal(dueDateFor(2028, 2, 30), "2028-02-29");
  assert.deepEqual(monthBounds("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
});

test("dates: validation + formatting", () => {
  assert.ok(isDateOnly("2026-10-01"));
  assert.ok(!isDateOnly("2026-02-30"));
  assert.ok(!isDateOnly("10/01/2026"));
  assert.equal(formatLong("2026-10-01"), "October 1, 2026");
  assert.equal(formatMonth("2026-10"), "October 2026");
  assert.equal(dateOnlyFromDbDate(dbDateFromDateOnly("2026-10-01")), "2026-10-01");
});

test("todayIn resolves the business timezone, not UTC", () => {
  // 2026-10-01 03:00 UTC is still Sept 30 in Houston (CDT, UTC-5)
  const instant = new Date("2026-10-01T03:00:00Z");
  assert.equal(todayIn("America/Chicago", instant), "2026-09-30");
  assert.equal(todayIn("UTC", instant), "2026-10-01");
});
