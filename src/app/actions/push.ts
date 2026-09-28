"use server";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/actions";
import { getSessionUser } from "@/lib/auth/session";
import { limiters } from "@/lib/security/rate-limit";
import { UserError } from "@/server/errors";
import { sendTestNotification } from "@/server/notifications";

export async function sendTestPushAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(prev, formData, z.object({}), async () => {
    const user = await getSessionUser();
    if (!user) throw new UserError("Please sign in again.");
    const rl = limiters.push.hit(`test:${user.id}`);
    if (!rl.allowed) throw new UserError("Too many tests. Try again in a few minutes.");
    const { devices } = await sendTestNotification(user, user.role === "ADMIN" ? "/admin/notifications" : "/notifications");
    return { message: `Test sent to ${devices} device${devices === 1 ? "" : "s"}. It should appear within a few seconds.` };
  });
}
