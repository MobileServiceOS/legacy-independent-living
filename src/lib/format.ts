import { dateOnlyFromDbDate, dateOnlyFromInstant, type DateOnly } from "../domain/dates";

/** The calendar date a payment "happened": paidOn when settled/recorded, else when it was started. */
export function paymentDate(p: { paidOn: Date | null; createdAt: Date }, timeZone: string): DateOnly {
  return p.paidOn ? dateOnlyFromDbDate(p.paidOn) : dateOnlyFromInstant(p.createdAt, timeZone);
}

const DATETIME = (tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function formatDateTime(d: Date, timeZone: string): string {
  return DATETIME(timeZone).format(d);
}
