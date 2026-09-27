import { prisma } from "../lib/db";
import type { PlacementRoom } from "../components/placement-form";

/** Rooms a resident can be placed in right now. */
export async function assignableRooms(): Promise<PlacementRoom[]> {
  const rooms = await prisma.room.findMany({
    where: { status: { in: ["AVAILABLE", "RESERVED"] }, property: { archivedAt: null } },
    include: { property: { select: { name: true } } },
    orderBy: [{ property: { name: "asc" } }, { name: "asc" }],
  });
  return rooms.map((r) => ({ id: r.id, name: r.name, propertyName: r.property.name, defaultRentCents: r.defaultRentCents, status: r.status }));
}
