/** Room occupancy rules + portfolio metrics. */
import { percent } from "./money.ts";

export const ROOM_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  RESERVED: "Reserved",
  MAINTENANCE: "Maintenance",
};

/** Admin may set these manually; OCCUPIED is only ever set by assigning a resident. */
export const MANUAL_ROOM_STATUSES: readonly RoomStatus[] = ["AVAILABLE", "RESERVED", "MAINTENANCE"];

export function canAssignResident(status: RoomStatus): boolean {
  return status === "AVAILABLE" || status === "RESERVED";
}

export interface OccupancyMetrics {
  totalRooms: number;
  occupied: number;
  available: number;
  reserved: number;
  maintenance: number;
  occupancyRate: number; // 0–100, one decimal
}

export function occupancyMetrics(rooms: ReadonlyArray<{ status: RoomStatus }>): OccupancyMetrics {
  const count = (s: RoomStatus) => rooms.filter((r) => r.status === s).length;
  const occupied = count("OCCUPIED");
  return {
    totalRooms: rooms.length,
    occupied,
    available: count("AVAILABLE"),
    reserved: count("RESERVED"),
    maintenance: count("MAINTENANCE"),
    occupancyRate: percent(occupied, rooms.length),
  };
}
