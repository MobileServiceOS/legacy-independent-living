/**
 * Calendar dates (rent due dates, move-in dates, ledger effective dates) are
 * modelled as timezone-free "YYYY-MM-DD" strings. This removes the entire
 * class of off-by-one bugs caused by converting midnight between timezones.
 * "Today" is always resolved in the business timezone (Houston → America/Chicago).
 */

export type DateOnly = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DEFAULT_TIMEZONE = "America/Chicago";

export function parseDateOnly(value: DateOnly): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(value);
  if (!match) throw new Error(`Invalid date: ${value}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error(`Invalid date: ${value}`);
  return { y, m, d };
}

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== "string") return false;
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
}

export function toDateOnly(y: number, m: number, d: number): DateOnly {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toUtcMs(value: DateOnly): number {
  const { y, m, d } = parseDateOnly(value);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): DateOnly {
  const date = new Date(ms);
  return toDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(value: DateOnly, days: number): DateOnly {
  return fromUtcMs(toUtcMs(value) + days * 86_400_000);
}

/** Whole days from b to a (a - b). diffDays("2026-10-03","2026-10-01") === 2 */
export function diffDays(a: DateOnly, b: DateOnly): number {
  return Math.round((toUtcMs(a) - toUtcMs(b)) / 86_400_000);
}

export function compareDates(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0; // ISO strings sort lexically
}

export function minDate(a: DateOnly, b: DateOnly): DateOnly {
  return a <= b ? a : b;
}

export function maxDate(a: DateOnly, b: DateOnly): DateOnly {
  return a >= b ? a : b;
}

export function addMonths(y: number, m: number, n: number): { y: number; m: number } {
  const index = y * 12 + (m - 1) + n;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/** Due date for a month, clamping day 29–31 to the month's last day. */
export function dueDateFor(y: number, m: number, dueDay: number): DateOnly {
  return toDateOnly(y, m, Math.min(dueDay, daysInMonth(y, m)));
}

export function monthKey(value: DateOnly): string {
  return value.slice(0, 7);
}

export function monthBounds(key: string): { start: DateOnly; end: DateOnly } {
  const [ys, ms] = key.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) throw new Error(`Invalid month: ${key}`);
  return { start: toDateOnly(y, m, 1), end: toDateOnly(y, m, daysInMonth(y, m)) };
}

/** Today's calendar date in the given IANA timezone. */
export function todayIn(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): DateOnly {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(now);
}

/** JS Date (e.g. a DB timestamp) → calendar date in the business timezone. */
export function dateOnlyFromInstant(instant: Date, timeZone: string = DEFAULT_TIMEZONE): DateOnly {
  return todayIn(timeZone, instant);
}

/** DB `date` columns arrive as UTC-midnight Dates; convert without shifting. */
export function dateOnlyFromDbDate(value: Date): DateOnly {
  return value.toISOString().slice(0, 10);
}

export function dbDateFromDateOnly(value: DateOnly): Date {
  parseDateOnly(value);
  return new Date(`${value}T00:00:00.000Z`);
}

const LONG = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

/** "2026-10-01" → "October 1, 2026" */
export function formatLong(value: DateOnly): string {
  return LONG.format(new Date(toUtcMs(value)));
}

/** "2026-10-01" → "Oct 1, 2026" */
export function formatShort(value: DateOnly): string {
  return SHORT.format(new Date(toUtcMs(value)));
}

/** "2026-10" → "October 2026" */
export function formatMonth(key: string): string {
  return MONTH.format(new Date(toUtcMs(`${key}-01`)));
}
