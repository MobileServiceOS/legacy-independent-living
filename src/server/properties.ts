import { Prisma } from "@prisma/client";
import type { RoomStatus } from "../domain/rooms";
import { audit, AUDIT_ACTIONS, type Actor } from "../lib/audit";
import { prisma } from "../lib/db";
import { NotFoundError, UserError } from "./errors";

export interface PropertyInput {
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  notes: string | null;
}

function uniqueGuard(err: unknown, message: string, field: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new UserError(message, field);
  throw err;
}

export async function saveProperty(actor: Actor, propertyId: string | undefined, input: PropertyInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (propertyId) {
        const before = await tx.property.findUnique({ where: { id: propertyId } });
        if (!before) throw new NotFoundError("Property");
        const p = await tx.property.update({ where: { id: propertyId }, data: input });
        await audit(tx, actor, AUDIT_ACTIONS.propertyEdited, "property", p.id, { name: p.name });
        return p;
      }
      const p = await tx.property.create({ data: input });
      await audit(tx, actor, AUDIT_ACTIONS.propertyCreated, "property", p.id, { name: p.name });
      return p;
    });
  } catch (err) {
    return uniqueGuard(err, "A property with that name already exists", "name");
  }
}

export async function saveRoom(
  actor: Actor,
  input: { roomId?: string; propertyId: string; name: string; defaultRent: number; notes: string | null },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const property = await tx.property.findUnique({ where: { id: input.propertyId } });
      if (!property) throw new NotFoundError("Property");
      if (input.roomId) {
        const before = await tx.room.findUnique({ where: { id: input.roomId } });
        if (!before || before.propertyId !== input.propertyId) throw new NotFoundError("Room");
        const r = await tx.room.update({
          where: { id: input.roomId },
          data: { name: input.name, defaultRentCents: input.defaultRent, notes: input.notes },
        });
        await audit(tx, actor, AUDIT_ACTIONS.roomEdited, "room", r.id, {
          name: r.name,
          defaultRentCents: { from: before.defaultRentCents, to: r.defaultRentCents },
        });
        return r;
      }
      const r = await tx.room.create({
        data: { propertyId: input.propertyId, name: input.name, defaultRentCents: input.defaultRent, notes: input.notes },
      });
      await audit(tx, actor, AUDIT_ACTIONS.roomCreated, "room", r.id, { propertyId: input.propertyId, name: r.name });
      return r;
    });
  } catch (err) {
    return uniqueGuard(err, "That property already has a room with this name", "name");
  }
}

/** Manual statuses only; OCCUPIED is controlled by resident assignment. */
export async function setRoomStatus(actor: Actor, roomId: string, status: Exclude<RoomStatus, "OCCUPIED">) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`;
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundError("Room");
    const occupied = await tx.roomAssignment.findFirst({ where: { roomId, endDate: null } });
    if (occupied) throw new UserError("Move the resident out or transfer them before changing this room's status");
    await tx.room.update({ where: { id: roomId }, data: { status } });
    await audit(tx, actor, AUDIT_ACTIONS.roomStatusChanged, "room", roomId, { from: room.status, to: status });
  });
}
