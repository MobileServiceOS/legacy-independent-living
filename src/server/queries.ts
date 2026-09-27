/** Read models for dashboards, directories and reports. All money is derived from ledgers. */
import type { PaymentMethodType, PaymentStatus, Prisma, ResidentStatus } from "@prisma/client";
import { addDays, dateOnlyFromDbDate, diffDays, monthKey, parseDateOnly, toDateOnly, type DateOnly } from "../domain/dates";
import { deriveRentPosition, type RentPosition, type RentStatus } from "../domain/rent";
import { collectionMetrics } from "../domain/reports";
import { occupancyMetrics } from "../domain/rooms";
import { prisma } from "../lib/db";
import { toLine, toScheduleInput } from "./ledger";

export interface ResidentRow {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: ResidentStatus;
  isDemo: boolean;
  propertyId: string | null;
  propertyName: string | null;
  roomId: string | null;
  roomName: string | null;
  monthlyRentCents: number | null;
  dueDay: number | null;
  position: RentPosition;
  accountStatus: "INVITED" | "ACTIVE" | "DISABLED" | null;
}

const URGENCY: Record<RentStatus, number> = { OVERDUE: 0, DUE: 1, PARTIAL: 2, PENDING: 3, DUE_SOON: 4, PAID: 5 };

export async function residentRows(today: DateOnly, where: Prisma.ResidentWhereInput = {}): Promise<ResidentRow[]> {
  const residents = await prisma.resident.findMany({
    where,
    include: {
      user: { select: { status: true } },
      assignments: { orderBy: { startDate: "desc" }, take: 1, include: { room: { include: { property: true } } } },
      rentSchedules: { where: { endDate: null }, take: 1 },
      ledgerEntries: true,
      payments: { where: { status: "PROCESSING" }, select: { amountCents: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return residents.map((r) => {
    const a = r.assignments[0];
    const current = a && (a.endDate === null || r.status === "MOVED_OUT") ? a : undefined;
    const schedule = r.rentSchedules[0];
    const position = deriveRentPosition({
      lines: r.ledgerEntries.map(toLine),
      today,
      pendingCents: r.payments.reduce((s, p) => s + p.amountCents, 0),
      schedule: schedule ? toScheduleInput(schedule) : null,
    });
    return {
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      phone: r.phone,
      status: r.status,
      isDemo: r.isDemo,
      propertyId: current?.room.propertyId ?? null,
      propertyName: current?.room.property.name ?? null,
      roomId: current?.roomId ?? null,
      roomName: current?.room.name ?? null,
      monthlyRentCents: schedule?.monthlyRentCents ?? null,
      dueDay: schedule?.dueDay ?? null,
      position,
      accountStatus: r.user?.status ?? null,
    };
  });
}

export function sortByUrgency(rows: ResidentRow[]): ResidentRow[] {
  return [...rows].sort(
    (a, b) =>
      URGENCY[a.position.status] - URGENCY[b.position.status] ||
      b.position.daysOverdue - a.position.daysOverdue ||
      a.name.localeCompare(b.name),
  );
}

export async function adminDashboard(today: DateOnly) {
  const month = monthKey(today);
  const [rooms, rows, ledgers, pendingApps, recentPayments] = await Promise.all([
    prisma.room.findMany({ where: { property: { archivedAt: null } }, select: { status: true } }),
    residentRows(today, { status: "ACTIVE" }),
    prisma.resident.findMany({ select: { ledgerEntries: true } }),
    prisma.application.count({ where: { status: { in: ["NEW", "UNDER_REVIEW"] } } }),
    prisma.payment.findMany({
      where: { status: { in: ["SUCCEEDED", "PROCESSING"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { resident: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const occupancy = occupancyMetrics(rooms);
  const collection = collectionMetrics(
    ledgers.map((l) => ({ lines: l.ledgerEntries.map(toLine) })),
    month,
    today,
  );
  return {
    month,
    occupancy,
    collection,
    totalResidents: rows.length,
    rentDue: sortByUrgency(rows),
    pendingApplications: pendingApps,
    recentPayments,
  };
}

export async function propertiesOverview(today: DateOnly) {
  const [properties, rows] = await Promise.all([
    prisma.property.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      include: {
        rooms: {
          orderBy: { name: "asc" },
          include: { assignments: { where: { endDate: null }, take: 1, select: { residentId: true } } },
        },
      },
    }),
    residentRows(today, { status: "ACTIVE" }),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return properties.map((p) => {
    const rooms = p.rooms.map((room) => {
      const residentId = room.assignments[0]?.residentId ?? null;
      return { ...room, resident: residentId ? (byId.get(residentId) ?? null) : null };
    });
    const occ = occupancyMetrics(rooms);
    const expected = rooms.reduce((s, r) => s + (r.resident?.monthlyRentCents ?? 0), 0);
    return { ...p, rooms, occupancy: occ, residentCount: occ.occupied, monthlyExpectedCents: expected };
  });
}

export type ResidentFilters = {
  q?: string;
  propertyId?: string;
  roomId?: string;
  paymentStatus?: RentStatus;
  status?: ResidentStatus | "ALL";
};

export async function listResidents(today: DateOnly, f: ResidentFilters) {
  const where: Prisma.ResidentWhereInput = {};
  if (f.status && f.status !== "ALL") where.status = f.status;
  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
  }
  let rows = await residentRows(today, where);
  if (f.propertyId) rows = rows.filter((r) => r.propertyId === f.propertyId);
  if (f.roomId) rows = rows.filter((r) => r.roomId === f.roomId);
  if (f.paymentStatus) rows = rows.filter((r) => r.position.status === f.paymentStatus);
  return rows;
}

export async function residentProfile(id: string, today: DateOnly) {
  const resident = await prisma.resident.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, status: true, lastLoginAt: true } },
      application: { select: { id: true, createdAt: true } },
      assignments: { orderBy: { startDate: "desc" }, include: { room: { include: { property: true } } } },
      rentSchedules: { orderBy: { startDate: "desc" } },
      ledgerEntries: { orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] },
      payments: { orderBy: { createdAt: "desc" } },
      documents: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!resident) return null;
  const [row] = await residentRows(today, { id });
  const audits = await prisma.auditLog.findMany({
    where: { OR: [{ entityType: "resident", entityId: id }, { metadata: { path: ["residentId"], equals: id } }] },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return { resident, row: row!, audits };
}

export type PaymentRange = "today" | "week" | "month" | "all";

export function rangeStart(range: PaymentRange, today: DateOnly): DateOnly | null {
  if (range === "today") return today;
  if (range === "week") {
    const { y, m, d } = parseDateOnly(today);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
    return addDays(today, -((dow + 6) % 7)); // Monday
  }
  if (range === "month") return `${monthKey(today)}-01`;
  return null;
}

export async function listPayments(
  today: DateOnly,
  f: { range?: PaymentRange; propertyId?: string; method?: PaymentMethodType; status?: PaymentStatus; q?: string; residentId?: string },
) {
  const where: Prisma.PaymentWhereInput = {};
  const start = rangeStart(f.range ?? "month", today);
  if (start) {
    const startDate = new Date(`${start}T00:00:00.000Z`);
    where.OR = [{ paidOn: { gte: startDate } }, { paidOn: null, createdAt: { gte: addHoursUtc(startDate, -14) } }];
  }
  if (f.method) where.method = f.method;
  if (f.status) where.status = f.status;
  if (f.residentId) where.residentId = f.residentId;
  if (f.q) {
    const q = f.q.trim();
    where.AND = [
      {
        OR: [
          { receiptNumber: { contains: q, mode: "insensitive" } },
          { reference: { contains: q, mode: "insensitive" } },
          { resident: { firstName: { contains: q, mode: "insensitive" } } },
          { resident: { lastName: { contains: q, mode: "insensitive" } } },
        ],
      },
    ];
  }
  if (f.propertyId) {
    where.resident = { assignments: { some: { room: { propertyId: f.propertyId } } } };
  }
  const payments = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      resident: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          assignments: { orderBy: { startDate: "desc" }, take: 1, include: { room: { include: { property: true } } } },
        },
      },
    },
  });
  const recorders = await prisma.user.findMany({
    where: { id: { in: payments.map((p) => p.recordedById).filter((x): x is string => Boolean(x)) } },
    select: { id: true, name: true },
  });
  const recorderName = new Map(recorders.map((u) => [u.id, u.name]));
  const rows = payments.map((p) => ({
    ...p,
    residentName: `${p.resident.firstName} ${p.resident.lastName}`,
    propertyName: p.resident.assignments[0]?.room.property.name ?? null,
    roomName: p.resident.assignments[0]?.room.name ?? null,
    recordedByName: p.recordedById ? (recorderName.get(p.recordedById) ?? "Admin") : null,
    dateOnly: p.paidOn ? dateOnlyFromDbDate(p.paidOn) : null,
  }));
  const totals = {
    count: rows.length,
    succeededCents: rows.filter((r) => r.status === "SUCCEEDED").reduce((s, r) => s + r.amountCents, 0),
    processingCents: rows.filter((r) => r.status === "PROCESSING").reduce((s, r) => s + r.amountCents, 0),
  };
  return { rows, totals, start };
}

function addHoursUtc(d: Date, hours: number) {
  return new Date(d.getTime() + hours * 3_600_000);
}

export async function reports(today: DateOnly, f: { month?: string; propertyId?: string }) {
  const month = f.month && /^\d{4}-\d{2}$/.test(f.month) ? f.month : monthKey(today);
  const residentWhere: Prisma.ResidentWhereInput = f.propertyId
    ? { assignments: { some: { room: { propertyId: f.propertyId } } } }
    : {};
  const [ledgers, rooms, rows, properties] = await Promise.all([
    prisma.resident.findMany({ where: residentWhere, select: { ledgerEntries: true } }),
    prisma.room.findMany({
      where: { property: { archivedAt: null, ...(f.propertyId ? { id: f.propertyId } : {}) } },
      select: { status: true, propertyId: true },
    }),
    residentRows(today, residentWhere),
    prisma.property.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const collection = collectionMetrics(ledgers.map((l) => ({ lines: l.ledgerEntries.map(toLine) })), month, today);
  const occupancy = occupancyMetrics(rooms);
  const outstanding = rows
    .filter((r) => r.position.balanceCents > 0)
    .sort((a, b) => b.position.daysOverdue - a.position.daysOverdue || b.position.balanceCents - a.position.balanceCents);
  const byProperty = properties
    .filter((p) => !f.propertyId || p.id === f.propertyId)
    .map((p) => ({ ...p, occupancy: occupancyMetrics(rooms.filter((r) => r.propertyId === p.id)) }));
  return { month, collection, occupancy, outstanding, byProperty, properties };
}

/** Last N month keys ending with the current one (for month pickers). */
export function recentMonths(today: DateOnly, n = 12): string[] {
  const { y, m } = parseDateOnly(today);
  return Array.from({ length: n }, (_, i) => {
    const idx = y * 12 + (m - 1) - i;
    return toDateOnly(Math.floor(idx / 12), (idx % 12) + 1, 1).slice(0, 7);
  });
}

export function daysBetween(a: DateOnly, b: DateOnly) {
  return diffDays(a, b);
}
