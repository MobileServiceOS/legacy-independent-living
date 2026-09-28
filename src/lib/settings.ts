import type { Settings } from "@prisma/client";
import type { RentSettings } from "../domain/rent";
import type { PaymentPolicy } from "../domain/payments";
import { todayIn } from "../domain/dates";
import { prisma, type Db } from "./db";

export async function getSettings(db: Db = prisma): Promise<Settings> {
  const s = await db.settings.findUnique({ where: { id: 1 } });
  if (s) return s;
  return db.settings.create({ data: { id: 1 } });
}

export function rentSettingsOf(s: Settings): RentSettings {
  return { chargeLeadDays: s.chargeLeadDays, graceDays: s.graceDays, lateFeeCents: s.lateFeeCents };
}

export function paymentPolicyOf(s: Settings): PaymentPolicy {
  return {
    allowPartialPayments: s.allowPartialPayments,
    minPartialPaymentCents: s.minPartialPaymentCents,
    allowPayAhead: s.allowPayAhead,
    maxPayAheadMonths: s.maxPayAheadMonths,
  };
}

/** "Today" in the business timezone. Override with APP_TODAY=YYYY-MM-DD for demos/tests. */
export function businessToday(s: Pick<Settings, "timezone">): string {
  const override = process.env.APP_TODAY;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  return todayIn(s.timezone);
}
