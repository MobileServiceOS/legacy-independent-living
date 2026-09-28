import type { Settings } from "@prisma/client";
import { audit, AUDIT_ACTIONS, type Actor } from "../lib/audit";
import { prisma } from "../lib/db";

export async function updateSettings(
  actor: Actor,
  input: {
    businessName: string;
    timezone: string;
    chargeLeadDays: number;
    graceDays: number;
    lateFee: number;
    allowPartialPayments: boolean;
    minPartialPayment: number;
    allowPayAhead: boolean;
    maxPayAheadMonths: number;
    onlinePaymentsEnabled: boolean;
    supportPhone: string | null;
    supportEmail: string | null;
  },
): Promise<Settings> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
    const data = {
      businessName: input.businessName,
      timezone: input.timezone,
      chargeLeadDays: input.chargeLeadDays,
      graceDays: input.graceDays,
      lateFeeCents: input.lateFee,
      allowPartialPayments: input.allowPartialPayments,
      minPartialPaymentCents: input.minPartialPayment,
      allowPayAhead: input.allowPayAhead,
      maxPayAheadMonths: input.maxPayAheadMonths,
      onlinePaymentsEnabled: input.onlinePaymentsEnabled,
      supportPhone: input.supportPhone,
      supportEmail: input.supportEmail,
      updatedById: actor.id,
    };
    const after = await tx.settings.update({ where: { id: 1 }, data });
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(data) as Array<keyof typeof data>) {
      if (k === "updatedById") continue;
      if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] };
    }
    await audit(tx, actor, AUDIT_ACTIONS.settingsChanged, "settings", "1", { changes });
    return after;
  });
}
