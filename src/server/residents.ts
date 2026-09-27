/**
 * Resident lifecycle: placement (application conversion or direct add),
 * room transfer, rent change, manual ledger entries, move-out, invites.
 * Every mutation runs in one transaction and writes an audit record.
 */
import { Prisma } from "@prisma/client";
import { canAssignResident } from "../domain/rooms";
import { addDays, dateOnlyFromDbDate, dbDateFromDateOnly, type DateOnly } from "../domain/dates";
import { formatCents } from "../domain/money";
import type { LedgerEntryType } from "../domain/ledger";
import { audit, AUDIT_ACTIONS, type Actor } from "../lib/audit";
import { prisma, type Db, type Tx } from "../lib/db";
import { env } from "../lib/env";
import { notify, notifyAdmins } from "../lib/notify";
import { generateToken, hashToken } from "../lib/security/crypto";
import { businessToday, getSettings } from "../lib/settings";
import { NotFoundError, UserError } from "./errors";
import { activeSchedule, postLedgerEntry } from "./ledger";
import { runRentEngineForResident } from "./rent-engine";

const INVITE_DAYS = 14;

async function lockRoom(tx: Tx, roomId: string) {
  await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`;
  const room = await tx.room.findUnique({ where: { id: roomId }, include: { property: true } });
  if (!room) throw new NotFoundError("Room");
  return room;
}

async function lockResident(tx: Tx, residentId: string) {
  await tx.$queryRaw`SELECT id FROM residents WHERE id = ${residentId} FOR UPDATE`;
  const resident = await tx.resident.findUnique({ where: { id: residentId } });
  if (!resident) throw new NotFoundError("Resident");
  return resident;
}

export async function issueInvite(db: Db, actor: Actor, userId: string): Promise<string> {
  await db.inviteToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  const token = generateToken();
  await db.inviteToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      createdById: actor.id,
    },
  });
  await audit(db, actor, AUDIT_ACTIONS.inviteIssued, "user", userId, { expiresInDays: INVITE_DAYS });
  return `${env.appUrl}/invite/${token}`;
}

export interface PlacementInput {
  applicationId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  notes: string | null;
  roomId: string;
  monthlyRent: number; // cents
  moveInDate: DateOnly;
  dueDay: number;
}

/**
 * Convert an approved applicant (or add a resident directly):
 * creates resident + login, assigns the room, marks it occupied, sets the rent
 * schedule and posts any rent already inside the billing window.
 */
export async function placeResident(actor: Actor, input: PlacementInput): Promise<{ residentId: string; inviteUrl: string }> {
  return prisma.$transaction(async (tx) => {
    const room = await lockRoom(tx, input.roomId);
    if (room.property.archivedAt) throw new UserError("That property is archived", "roomId");
    if (!canAssignResident(room.status)) throw new UserError(`${room.name} is ${room.status.toLowerCase()} — choose an available room`, "roomId");

    let application = null;
    if (input.applicationId) {
      await tx.$queryRaw`SELECT id FROM applications WHERE id = ${input.applicationId} FOR UPDATE`;
      application = await tx.application.findUnique({ where: { id: input.applicationId } });
      if (!application) throw new NotFoundError("Application");
      if (application.status !== "APPROVED") throw new UserError("Only approved applications can be converted");
    }

    const existingUser = await tx.user.findUnique({ where: { email: input.email }, include: { resident: true } });
    if (existingUser) throw new UserError("That email already belongs to an account", "email");

    const user = await tx.user.create({
      data: { email: input.email, name: `${input.firstName} ${input.lastName}`, role: "RESIDENT", status: "INVITED" },
    });
    const resident = await tx.resident.create({
      data: {
        userId: user.id,
        applicationId: application?.id ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactRelation: input.emergencyContactRelation,
        notes: input.notes,
        moveInDate: dbDateFromDateOnly(input.moveInDate),
      },
    });
    await tx.roomAssignment.create({
      data: {
        residentId: resident.id,
        roomId: room.id,
        startDate: dbDateFromDateOnly(input.moveInDate),
        reason: application ? "Converted from application" : "Resident added",
        createdById: actor.id,
      },
    });
    await tx.room.update({ where: { id: room.id }, data: { status: "OCCUPIED" } });
    const schedule = await tx.rentSchedule.create({
      data: {
        residentId: resident.id,
        monthlyRentCents: input.monthlyRent,
        dueDay: input.dueDay,
        startDate: dbDateFromDateOnly(input.moveInDate),
        createdById: actor.id,
      },
    });
    if (application) {
      await tx.application.update({
        where: { id: application.id },
        data: { status: "CONVERTED", decidedAt: application.decidedAt ?? new Date(), reviewedById: actor.id },
      });
      await audit(tx, actor, AUDIT_ACTIONS.applicationConverted, "application", application.id, { residentId: resident.id });
    }
    await audit(tx, actor, AUDIT_ACTIONS.residentCreated, "resident", resident.id, {
      propertyId: room.propertyId,
      roomId: room.id,
      monthlyRentCents: input.monthlyRent,
      dueDay: input.dueDay,
      moveInDate: input.moveInDate,
      rentScheduleId: schedule.id,
    });
    await audit(tx, actor, AUDIT_ACTIONS.roomAssigned, "room", room.id, { residentId: resident.id, startDate: input.moveInDate });

    await runRentEngineForResident(tx, resident.id);
    const inviteUrl = await issueInvite(tx, actor, user.id);
    await notify(tx, {
      userId: user.id,
      type: "ACCOUNT",
      title: `Welcome to ${room.property.name}`,
      body: `You're set up in ${room.name}. Rent is ${formatCents(input.monthlyRent)} a month, due on day ${input.dueDay}.`,
      link: "/home",
    });
    return { residentId: resident.id, inviteUrl };
  });
}

export async function transferRoom(actor: Actor, input: { residentId: string; roomId: string; effectiveDate: DateOnly; reason: string | null }) {
  return prisma.$transaction(async (tx) => {
    const resident = await lockResident(tx, input.residentId);
    if (resident.status !== "ACTIVE") throw new UserError("Only active residents can be transferred");
    const current = await tx.roomAssignment.findFirst({ where: { residentId: resident.id, endDate: null } });
    if (current && current.roomId === input.roomId) throw new UserError("Resident is already in that room", "roomId");
    const target = await lockRoom(tx, input.roomId);
    if (!canAssignResident(target.status)) throw new UserError(`${target.name} is not available`, "roomId");
    if (current) {
      if (input.effectiveDate < dateOnlyFromDbDate(current.startDate))
        throw new UserError("Transfer date can't be before the current room's start date", "effectiveDate");
      await lockRoom(tx, current.roomId);
      await tx.roomAssignment.update({ where: { id: current.id }, data: { endDate: dbDateFromDateOnly(input.effectiveDate) } });
      await tx.room.update({ where: { id: current.roomId }, data: { status: "AVAILABLE" } });
    }
    await tx.roomAssignment.create({
      data: {
        residentId: resident.id,
        roomId: target.id,
        startDate: dbDateFromDateOnly(input.effectiveDate),
        reason: input.reason ?? "Room transfer",
        createdById: actor.id,
      },
    });
    await tx.room.update({ where: { id: target.id }, data: { status: "OCCUPIED" } });
    await audit(tx, actor, AUDIT_ACTIONS.roomTransferred, "resident", resident.id, {
      fromRoomId: current?.roomId ?? null,
      toRoomId: target.id,
      effectiveDate: input.effectiveDate,
      reason: input.reason,
    });
  });
}

export async function changeRent(
  actor: Actor,
  input: { residentId: string; monthlyRent: number; dueDay: number; effectiveDate: DateOnly; reason: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const resident = await lockResident(tx, input.residentId);
    if (resident.status !== "ACTIVE") throw new UserError("Rent can only be changed for active residents");
    const current = await activeSchedule(tx, resident.id);
    if (current) {
      const start = dateOnlyFromDbDate(current.startDate);
      if (input.effectiveDate <= start) {
        throw new UserError(`Effective date must be after the current rent started (${start})`, "effectiveDate");
      }
      await tx.rentSchedule.update({ where: { id: current.id }, data: { endDate: dbDateFromDateOnly(addDays(input.effectiveDate, -1)) } });
    }
    const next = await tx.rentSchedule.create({
      data: {
        residentId: resident.id,
        monthlyRentCents: input.monthlyRent,
        dueDay: input.dueDay,
        startDate: dbDateFromDateOnly(input.effectiveDate),
        createdById: actor.id,
      },
    });
    await audit(tx, actor, AUDIT_ACTIONS.rentChanged, "resident", resident.id, {
      fromCents: current?.monthlyRentCents ?? null,
      toCents: input.monthlyRent,
      fromDueDay: current?.dueDay ?? null,
      toDueDay: input.dueDay,
      effectiveDate: input.effectiveDate,
      rentScheduleId: next.id,
      reason: input.reason,
    });
    await runRentEngineForResident(tx, resident.id);
  });
}

const KIND_TO_ENTRY: Record<string, { type: LedgerEntryType; sign: 1 | -1; action: string }> = {
  OTHER_CHARGE: { type: "OTHER_CHARGE", sign: 1, action: AUDIT_ACTIONS.chargeAdded },
  LATE_FEE: { type: "LATE_FEE", sign: 1, action: AUDIT_ACTIONS.chargeAdded },
  CREDIT: { type: "CREDIT", sign: -1, action: AUDIT_ACTIONS.creditIssued },
  ADJUSTMENT_UP: { type: "ADJUSTMENT", sign: 1, action: AUDIT_ACTIONS.adjustmentPosted },
  ADJUSTMENT_DOWN: { type: "ADJUSTMENT", sign: -1, action: AUDIT_ACTIONS.adjustmentPosted },
};

export async function addManualLedgerEntry(
  actor: Actor,
  input: { residentId: string; kind: keyof typeof KIND_TO_ENTRY; amount: number; effectiveDate: DateOnly; description: string },
) {
  const spec = KIND_TO_ENTRY[input.kind];
  if (!spec) throw new UserError("Unknown entry type");
  return prisma.$transaction(async (tx) => {
    await lockResident(tx, input.residentId);
    const entry = await postLedgerEntry(tx, actor, {
      residentId: input.residentId,
      type: spec.type,
      amountCents: spec.sign * input.amount,
      description: input.description,
      effectiveDate: input.effectiveDate,
      dueDate: spec.sign > 0 ? input.effectiveDate : null,
    });
    await audit(tx, actor, spec.action, "resident", input.residentId, {
      ledgerEntryId: entry.id,
      type: spec.type,
      amountCents: entry.amountCents,
      description: input.description,
    });
    return entry;
  });
}

export async function moveOutResident(actor: Actor, input: { residentId: string; moveOutDate: DateOnly; reason: string | null }) {
  return prisma.$transaction(async (tx) => {
    const resident = await lockResident(tx, input.residentId);
    if (resident.status === "MOVED_OUT") throw new UserError("Resident has already moved out");
    const moveIn = dateOnlyFromDbDate(resident.moveInDate);
    if (input.moveOutDate < moveIn) throw new UserError(`Move-out date can't be before move-in (${moveIn})`, "moveOutDate");

    const assignment = await tx.roomAssignment.findFirst({ where: { residentId: resident.id, endDate: null } });
    if (assignment) {
      const start = dateOnlyFromDbDate(assignment.startDate);
      await lockRoom(tx, assignment.roomId);
      await tx.roomAssignment.update({
        where: { id: assignment.id },
        data: { endDate: dbDateFromDateOnly(input.moveOutDate < start ? start : input.moveOutDate) },
      });
      await tx.room.update({ where: { id: assignment.roomId }, data: { status: "AVAILABLE" } });
    }
    const schedule = await activeSchedule(tx, resident.id);
    if (schedule) {
      const start = dateOnlyFromDbDate(schedule.startDate);
      const end = input.moveOutDate < start ? addDays(start, -1) : input.moveOutDate;
      await tx.rentSchedule.update({ where: { id: schedule.id }, data: { endDate: dbDateFromDateOnly(end) } });
    }

    // Reverse rent that was posted in advance for periods after move-out.
    const futureRent = await tx.ledgerEntry.findMany({
      where: { residentId: resident.id, type: "RENT_CHARGE", dueDate: { gt: dbDateFromDateOnly(input.moveOutDate) } },
    });
    for (const charge of futureRent) {
      await postLedgerEntry(tx, actor, {
        residentId: resident.id,
        type: "ADJUSTMENT",
        amountCents: -charge.amountCents,
        description: `Reversal — ${charge.description} (after move-out)`,
        effectiveDate: input.moveOutDate,
        relatedEntryId: charge.id,
        idempotencyKey: `reverse:${charge.id}`,
      });
    }

    await tx.resident.update({
      where: { id: resident.id },
      data: { status: "MOVED_OUT", moveOutDate: dbDateFromDateOnly(input.moveOutDate) },
    });
    await audit(tx, actor, AUDIT_ACTIONS.residentMovedOut, "resident", resident.id, {
      moveOutDate: input.moveOutDate,
      roomId: assignment?.roomId ?? null,
      reversedCharges: futureRent.map((c) => c.id),
      reason: input.reason,
    });
  });
}

export async function updateResident(
  actor: Actor,
  input: {
    residentId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    emergencyContactRelation: string | null;
    notes: string | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    const before = await lockResident(tx, input.residentId);
    const { residentId, ...data } = input;
    if (before.userId && data.email !== before.email) {
      const clash = await tx.user.findUnique({ where: { email: data.email } });
      if (clash && clash.id !== before.userId) throw new UserError("That email already belongs to another account", "email");
    }
    try {
      await tx.resident.update({ where: { id: residentId }, data });
      if (before.userId) {
        await tx.user.update({ where: { id: before.userId }, data: { email: data.email, name: `${data.firstName} ${data.lastName}` } });
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        throw new UserError("That email already belongs to another account", "email");
      throw err;
    }
    const changed = Object.keys(data).filter((k) => (before as Record<string, unknown>)[k] !== (data as Record<string, unknown>)[k]);
    await audit(tx, actor, AUDIT_ACTIONS.residentEdited, "resident", residentId, { changedFields: changed });
  });
}

/**
 * One-time link to set (new account) or reset (existing account) a password.
 * Earlier links stop working. Used for "forgot password" — the office shares it.
 */
export async function reissueInvite(actor: Actor, residentId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const resident = await tx.resident.findUnique({ where: { id: residentId }, include: { user: true } });
    if (!resident?.user) throw new NotFoundError("Resident account");
    if (resident.user.status === "DISABLED") throw new UserError("Sign-in is turned off for this resident. Turn it back on first.");
    const url = await issueInvite(tx, actor, resident.user.id);
    if (resident.user.status === "ACTIVE") await audit(tx, actor, "user.password_reset_link", "user", resident.user.id, { residentId });
    return url;
  });
}

/** Turn a resident's sign-in off (signs them out everywhere, stops push) or back on. */
export async function setSignInEnabled(actor: Actor, residentId: string, enabled: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const resident = await tx.resident.findUnique({ where: { id: residentId }, include: { user: true } });
    if (!resident?.user) throw new NotFoundError("Resident account");
    const u = resident.user;
    const next = enabled ? (u.passwordHash ? "ACTIVE" : "INVITED") : "DISABLED";
    if (u.status === next) return;
    await tx.user.update({ where: { id: u.id }, data: { status: next } });
    if (!enabled) {
      await tx.session.deleteMany({ where: { userId: u.id } });
      await tx.inviteToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.pushSubscription.updateMany({ where: { userId: u.id, disabledAt: null }, data: { disabledAt: new Date() } });
    }
    await audit(tx, actor, enabled ? "user.sign_in_enabled" : "user.sign_in_disabled", "resident", residentId, { userId: u.id });
  });
}

/** Resident asks for their account to be deleted (App Store 5.1.1(v)). The office completes it. */
export async function requestAccountDeletion(user: { id: string; email: string; name: string }, reason: string | null, today: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const created = await notify(tx, {
      userId: user.id,
      type: "ACCOUNT",
      title: "We received your deletion request",
      body: "The office will contact you to confirm. Payment records are kept as required by law; everything else is removed.",
      dedupeKey: `deletion-ack:${user.id}:${today}`,
    });
    if (!created) return false;
    const resident = await tx.resident.findUnique({ where: { userId: user.id }, select: { id: true } });
    await notifyAdmins(tx, {
      type: "ACCOUNT",
      title: "Account deletion requested",
      body: `${user.name} (${user.email}) asked to delete their account.${reason ? ` Reason: ${reason}` : ""}`,
      link: resident ? `/admin/residents/${resident.id}` : "/admin/residents",
      dedupeKey: `deletion:${user.id}:${today}`,
    });
    await audit(tx, { id: user.id, email: user.email, role: "RESIDENT" }, "user.deletion_requested", "user", user.id, { reason });
    return true;
  });
}

/** Default move-in date for forms: today in business tz. */
export async function defaultToday(): Promise<DateOnly> {
  return businessToday(await getSettings());
}
