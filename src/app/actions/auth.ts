"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { homePathFor } from "@/domain/permissions";
import { runAction, type ActionState } from "@/lib/actions";
import { clearSessionCookie, requestMeta, setSessionCookie } from "@/lib/auth/session";
import { limiters } from "@/lib/security/rate-limit";
import { loginSchema, setPasswordSchema } from "@/lib/validation";
import { acceptInvite, authenticate, createSession, revokeSession } from "@/server/auth";
import { UserError } from "@/server/errors";

function safeNext(next: string | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export async function loginAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(prev, formData, loginSchema.extend({ next: z.string().max(500).optional() }), async ({ email, password, next }) => {
    const meta = await requestMeta();
    const key = `${meta.ip ?? "unknown"}:${email}`;
    const rl = limiters.login.hit(key);
    if (!rl.allowed) throw new UserError(`Too many sign-in attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`);
    const user = await authenticate(email, password);
    limiters.login.reset(key);
    const { token, expiresAt } = await createSession(user, meta);
    await setSessionCookie(token, expiresAt);
    const home = homePathFor(user.role);
    // Only honor ?next= inside the signed-in role's own area.
    const target = safeNext(next, home);
    const allowed =
      user.role === "ADMIN"
        ? /^\/(admin|receipts)(\/|\?|$)/.test(target)
        : /^\/(home|pay|payments|documents|notifications|profile|receipts)(\/|\?|$)/.test(target);
    return { redirectTo: allowed ? target : home };
  });
}

export async function logoutAction(): Promise<void> {
  const token = await clearSessionCookie();
  await revokeSession(token);
  redirect("/login?signedOut=1");
}

export async function acceptInviteAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(prev, formData, setPasswordSchema, async ({ token, password }) => {
    const meta = await requestMeta();
    const rl = limiters.invite.hit(meta.ip ?? "unknown");
    if (!rl.allowed) throw new UserError("Too many attempts. Please wait a few minutes.");
    const user = await acceptInvite(token, password);
    const session = await createSession(user, meta);
    await setSessionCookie(session.token, session.expiresAt);
    return { redirectTo: homePathFor(user.role) };
  });
}
