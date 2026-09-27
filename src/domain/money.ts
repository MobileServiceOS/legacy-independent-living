/**
 * Money is ALWAYS an integer number of cents. Never use floats for currency.
 * All arithmetic goes through these helpers so overflow / non-integer values
 * are caught at the boundary instead of silently corrupting a ledger.
 */

export type Cents = number;

export const MAX_CENTS = 100_000_000_00; // $100M — sanity ceiling for a single amount

export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertCents(value: unknown, label = "amount"): asserts value is Cents {
  if (!isCents(value)) throw new Error(`${label} must be an integer number of cents`);
  if (Math.abs(value) > MAX_CENTS) throw new Error(`${label} exceeds the allowed maximum`);
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  assertCents(total, "total");
  return total;
}

const DOLLARS_RE = /^\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.(\d{1,2}))?$/;

/**
 * Parse user-entered dollars ("750", "750.5", "$1,250.00") into positive cents.
 * Returns null for anything ambiguous, negative, or with >2 decimals.
 * Parsing is string-based — no float math is ever involved.
 */
export function parseDollarsToCents(input: string): Cents | null {
  const trimmed = input.trim();
  const match = DOLLARS_RE.exec(trimmed);
  if (!match) return null;
  const whole = match[1]!.replace(/,/g, "");
  const frac = (match[4] ?? "").padEnd(2, "0");
  const cents = Number(whole) * 100 + Number(frac || "0");
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}

/** Format cents as US dollars: 75000 → "$750.00", -2500 → "-$25.00". */
export function formatCents(cents: Cents, opts: { signed?: boolean } = {}): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = `$${dollars.toLocaleString("en-US")}.${rem.toString().padStart(2, "0")}`;
  if (negative) return `-${body}`;
  if (opts.signed && cents > 0) return `+${body}`;
  return body;
}

/** Cents → plain decimal string for form inputs: 75050 → "750.50". */
export function centsToInput(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

/** Percentage with one decimal, safe for zero denominators. 32/36 → 88.9 */
export function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}
