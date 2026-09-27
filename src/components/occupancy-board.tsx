import Link from "next/link";
import type { RoomStatus } from "@/domain/rooms";
import type { ResidentRow } from "@/server/queries";
import { DemoTag, Money, RentStatusBadge, RoomStatusBadge, cx } from "./ui";

const TILE: Record<RoomStatus, string> = {
  AVAILABLE: "border-ok/40 bg-ok-bg/60",
  OCCUPIED: "border-line bg-white",
  RESERVED: "border-warn/40 bg-warn-bg/60",
  MAINTENANCE: "border-bad/30 bg-bad-bg/50",
};

export interface BoardRoom {
  id: string;
  name: string;
  status: RoomStatus;
  defaultRentCents: number;
  resident: ResidentRow | null;
}

/** Visual room grid: see at a glance which rooms are occupied, available, reserved or down. */
export function OccupancyBoard({ rooms, propertyId }: { rooms: BoardRoom[]; propertyId: string }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="Rooms">
      {rooms.map((room) => (
        <li key={room.id} className={cx("flex min-h-32 flex-col rounded-xl border-2 p-3", TILE[room.status])}>
          <div className="flex items-start justify-between gap-2">
            <p className="font-serif text-xl font-semibold text-forest-deep">{room.name}</p>
          </div>
          <div className="mt-1">
            <RoomStatusBadge status={room.status} />
          </div>
          <div className="mt-auto pt-2 text-sm">
            {room.resident ? (
              <>
                <Link href={`/admin/residents/${room.resident.id}`} className="block truncate font-bold">
                  {room.resident.name}
                </Link>
                {room.resident.isDemo ? <DemoTag /> : null}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <RentStatusBadge status={room.resident.position.status} />
                </div>
              </>
            ) : room.status === "AVAILABLE" || room.status === "RESERVED" ? (
              <Link href={`/admin/residents/new?roomId=${room.id}`} className="font-bold">
                Place resident →
              </Link>
            ) : (
              <Link href={`/admin/properties/${propertyId}#room-${room.id}`} className="text-muted">
                Room details
              </Link>
            )}
            <p className="mt-1 text-xs text-muted">
              <Money cents={room.resident?.monthlyRentCents ?? room.defaultRentCents} />/mo
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
