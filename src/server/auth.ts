/** Authentication core (framework-free): credentials, sessions, invites. */
import type { User } from "@prisma/client";
import { audit, AUDIT_ACTIONS } from "../lib/audit";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import {
  DUMMY_PASSWORD_HASH,
  generateToken,
  hashPassword,
  hashToken,
  validatePasswordStrength,
  verifyPassword,
} from "../lib/security/crypto";
import { UserError } from "./errors";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "RESIDENT";
  residentId: string | null;
  sessionId: string;
}

const GENERIC_LOGIN_ERROR = "That email and password don't match our records";

/** Constant-work credential check (no user enumeration via timing or message). */
export async function authenticate(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !ok) throw new UserError(GENERIC_LOGIN_ERROR);
  if (user.status === "DISABLED") throw new UserError("This account is turned off. Please contact the office.");
  if (user.status !== "ACTIVE") throw new UserError(GENERIC_LOGIN_ERROR);
  return user;
}

export async function createSession(user: User, meta: { ip?: string | null; userAgent?: string | null }): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + env.sessionDays * 86_400_000);
  await prisma.$transaction([
    prisma.session.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
    }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    // opportunistic cleanup of this user's expired sessions
    prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } }),
  ]);
  await audit(prisma, { id: user.id, email: user.email, role: user.role }, AUDIT_ACTIONS.loginSucceeded, "user", user.id, {}, meta.ip);
  return { token, expiresAt };
}

const TOUCH_EVERY_MS = 60 * 60_000;

export async function lookupSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { resident: { select: { id: true } } } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date() || session.user.status !== "ACTIVE") {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    residentId: session.user.resident?.id ?? null,
    sessionId: session.id,
  };
}

export async function revokeSession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function findValidInvite(token: string) {
  const invite = await prisma.inviteToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date() || invite.user.status === "DISABLED") return null;
  return invite;
}

/** Resident sets their password from an invite link → account becomes ACTIVE. */
export async function acceptInvite(token: string, password: string): Promise<User> {
  const strength = validatePasswordStrength(password);
  if (strength) throw new UserError(strength, "password");
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const invite = await tx.inviteToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date() || invite.user.status === "DISABLED")
      throw new UserError("This link has expired or was already used. Ask the office for a new one.");
    await tx.inviteToken.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: invite.userId } });
    const user = await tx.user.update({ where: { id: invite.userId }, data: { passwordHash, status: "ACTIVE" } });
    await audit(tx, { id: user.id, email: user.email, role: user.role }, "user.password_set", "user", user.id);
    return user;
  });
}
