"use server";
import { runAction, type ActionState } from "@/lib/actions";
import { requestMeta } from "@/lib/auth/session";
import { limiters } from "@/lib/security/rate-limit";
import { applicationSchema } from "@/lib/validation";
import { submitApplication } from "@/server/applications";
import { UserError } from "@/server/errors";

export async function submitApplicationAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(prev, formData, applicationSchema, async (input) => {
    const meta = await requestMeta();
    const rl = limiters.apply.hit(meta.ip ?? "unknown");
    if (!rl.allowed) throw new UserError("We've received several applications from this device. Please call the office instead.");
    const { consent: _consent, website: _hp, ...data } = input;
    await submitApplication(data);
    return { redirectTo: "/apply/thanks" };
  });
}
