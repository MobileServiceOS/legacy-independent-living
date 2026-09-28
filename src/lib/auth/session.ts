/** Next.js glue for sessions: cookies, guards for pages and server actions. */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { can, homePathFor, type Permission } from "../../domain/permissions";
import { lookupSession, type SessionUser } from "../../server/auth";
import { ForbiddenError } from "../../server/errors";
import type { Actor } from "../audit";
import { env } from "../env";
import { clientIpFrom } from "../security/rate-limit";

export const SESSION_COOKIE = "lil_session";

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return lookupSession(jar.get(SESSION_COOKIE)?.value);
});

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  return token;
}

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = clientIpFrom(h.get("x-forwarded-for"), h.get("x-real-ip"));
  return { ip, userAgent: h.get("user-agent") };
}

export function actorOf(user: SessionUser): Actor {
  return { id: user.id, email: user.email, role: user.role };
}

// ---- Page guards (redirect) ----------------------------------------------

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePagePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect(homePathFor(user.role));
  return user;
}

export async function requireResidentPage(): Promise<SessionUser & { residentId: string }> {
  const user = await requireUser();
  if (user.role !== "RESIDENT" || !user.residentId) redirect(homePathFor(user.role));
  return user as SessionUser & { residentId: string };
}

// ---- Action guards (throw) -----------------------------------------------

export async function requireActionPermission(permission: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !can(user.role, permission)) throw new ForbiddenError();
  return user;
}

export async function requireResidentAction(): Promise<SessionUser & { residentId: string }> {
  const user = await getSessionUser();
  if (!user || user.role !== "RESIDENT" || !user.residentId || !can(user.role, "self:pay")) throw new ForbiddenError();
  return user as SessionUser & { residentId: string };
}
