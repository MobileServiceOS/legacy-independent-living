"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/actions";
import { requireResidentAction, getSessionUser } from "@/lib/auth/session";
import { limiters } from "@/lib/security/rate-limit";
import { onlinePaymentSchema } from "@/lib/validation";
import { ForbiddenError, UserError } from "@/server/errors";
import { markRead } from "@/server/notifications";
import { requestAccountDeletion } from "@/server/residents";
import { businessToday, getSettings } from "@/lib/settings";
import { completeSandboxPayment, startOnlinePayment } from "@/server/payments";

export async function startPaymentAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(prev, formData, onlinePaymentSchema, async (input) => {
    const user = await requireResidentAction();
    const rl = limiters.pay.hit(user.id);
    if (!rl.allowed) throw new UserError("Too many payment attempts. Please wait a few minutes and try again.");
    const { redirectUrl } = await startOnlinePayment(user, input);
    return { redirectTo: redirectUrl };
  });
}

const sandboxSchema = z.object({
  paymentId: z.string().min(1).max(64),
  outcome: z.enum(["succeed", "decline", "ach_pending", "cancel"]),
});

export async function sandboxOutcomeAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(prev, formData, sandboxSchema, async ({ paymentId, outcome }) => {
    const user = await requireResidentAction();
    await completeSandboxPayment(user, paymentId, outcome);
    revalidatePath("/home");
    return { redirectTo: outcome === "cancel" ? "/pay?canceled=1" : `/pay/return?payment=${encodeURIComponent(paymentId)}` };
  });
}

export async function requestDeletionAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({
    reason: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
    confirm: z.literal("on", { errorMap: () => ({ message: "Please confirm" }) }),
  });
  return runAction(prev, formData, schema, async ({ reason }) => {
    const user = await requireResidentAction();
    const created = await requestAccountDeletion(user, reason, businessToday(await getSettings()));
    return { message: created ? "Request sent. The office will contact you to confirm." : "You've already sent a request today — the office will be in touch." };
  });
}

/** Mark one (or all) of the signed-in user's notifications read. Works for residents and admins. */
export async function markNotificationsReadAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new ForbiddenError();
  const id = formData.get("notificationId");
  await markRead(user.id, typeof id === "string" && id ? id : undefined);
  revalidatePath("/notifications");
  revalidatePath("/admin/notifications");
  revalidatePath("/home");
}
