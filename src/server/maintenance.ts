/**
 * Maintenance requests. Residents report problems (with photos), follow the
 * timeline and message the office; staff triage, schedule, update and close.
 * Every change is a timeline entry (append-only) + audit record + notification.
 */
import type { MaintenancePhoto, MaintenanceRequest, Prisma } from "@prisma/client";
import { zonedLocalToUtc } from "../domain/dates";
import {
  canMoveMaintenance,
  compareQueue,
  isOpen,
  MAINTENANCE_STATUS_LABELS,
  MAX_MAINTENANCE_PHOTOS,
  maintenanceRef,
  REOPEN_WINDOW_DAYS,
  residentCanCancel,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "../domain/maintenance";
import { audit, type Actor } from "../lib/audit";
import { prisma, type Tx } from "../lib/db";
import { notify, notifyAdmins } from "../lib/notify";
import { getSettings } from "../lib/settings";
import { ALLOWED_UPLOAD_TYPES, IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, sniffMime, storage } from "../lib/storage";
import { ForbiddenError, NotFoundError, UserError } from "./errors";

export const MAINTENANCE_AUDIT = {
  submitted: "maintenance.submitted",
  updated: "maintenance.updated",
  canceled: "maintenance.canceled",
  reopened: "maintenance.reopened",
} as const;

export interface ResidentUser {
  id: string;
  name: string;
  email: string;
  residentId: string;
}

// ------------------------------------------------------------------ photos

interface StoredPhoto {
  key: string;
  mime: string;
  size: number;
}

/** Validate + store uploaded photos. Returns stored keys; caller links them (and removes on failure). */
async function storePhotos(files: File[]): Promise<StoredPhoto[]> {
  const real = files.filter((f) => f && f.size > 0);
  if (real.length > MAX_MAINTENANCE_PHOTOS) throw new UserError(`You can add up to ${MAX_MAINTENANCE_PHOTOS} photos`, "photos");
  const stored: StoredPhoto[] = [];
  try {
    for (const file of real) {
      if (file.size > MAX_UPLOAD_BYTES) throw new UserError("Each photo must be 10 MB or smaller", "photos");
      const buf = Buffer.from(await file.arrayBuffer());
      const mime = sniffMime(buf);
      if (!mime || !(IMAGE_MIME_TYPES as readonly string[]).includes(mime)) throw new UserError("Photos must be JPG, PNG, WEBP or HEIC images", "photos");
      stored.push({ key: await storage.put(buf, ALLOWED_UPLOAD_TYPES[mime]!), mime, size: buf.length });
    }
  } catch (err) {
    await Promise.all(stored.map((s) => storage.remove(s.key)));
    throw err;
  }
  return stored;
}

async function withPhotos<T>(files: File[], fn: (photos: StoredPhoto[]) => Promise<T>): Promise<T> {
  const photos = await storePhotos(files);
  try {
    return await fn(photos);
  } catch (err) {
    await Promise.all(photos.map((p) => storage.remove(p.key)));
    throw err;
  }
}

// ------------------------------------------------------------------ resident actions

export interface NewRequestInput {
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  title: string;
  description: string;
  location: string | null;
  permissionToEnter: boolean;
  entryNotes: string | null;
}

export async function submitMaintenanceRequest(user: ResidentUser, input: NewRequestInput, files: File[] = []): Promise<MaintenanceRequest> {
  return withPhotos(files, (photos) =>
    prisma.$transaction(async (tx) => {
      const resident = await tx.resident.findUnique({
        where: { id: user.residentId },
        include: { assignments: { where: { endDate: null }, take: 1, include: { room: { include: { property: true } } } } },
      });
      if (!resident) throw new ForbiddenError();
      if (resident.status !== "ACTIVE") throw new UserError("Only current residents can submit repair requests. Please contact the office.");
      const room = resident.assignments[0]?.room ?? null;

      const req = await tx.maintenanceRequest.create({
        data: {
          residentId: resident.id,
          propertyId: room?.propertyId ?? null,
          roomId: room?.id ?? null,
          category: input.category,
          priority: input.priority,
          title: input.title,
          description: input.description,
          location: input.location,
          permissionToEnter: input.permissionToEnter,
          entryNotes: input.permissionToEnter ? input.entryNotes : null,
          isDemo: resident.isDemo,
          photos: { create: photos.map((p) => ({ storageKey: p.key, mimeType: p.mime, sizeBytes: p.size, uploadedBy: user.id })) },
          updates: { create: { authorId: user.id, authorName: user.name, authorRole: "RESIDENT", toStatus: "SUBMITTED", body: null } },
        },
      });
      await audit(tx, { id: user.id, email: user.email, role: "RESIDENT" }, MAINTENANCE_AUDIT.submitted, "maintenance", req.id, {
        residentId: resident.id,
        number: req.number,
        category: req.category,
        priority: req.priority,
        photos: photos.length,
      });
      const where = room ? `${room.property.name} · ${room.name}` : "no room on file";
      await notifyAdmins(tx, {
        type: "MAINTENANCE_SUBMITTED",
        title: `${req.priority === "URGENT" ? "URGENT repair" : "New repair request"} ${maintenanceRef(req.number)}`,
        body: `${resident.firstName} ${resident.lastName} (${where}): ${req.title}`,
        link: `/admin/maintenance/${req.id}`,
        dedupeKey: `maintenance-submitted:${req.id}`,
      });
      return req;
    }),
  );
}

async function loadOwn(tx: Tx, user: ResidentUser, requestId: string) {
  await tx.$queryRaw`SELECT id FROM maintenance_requests WHERE id = ${requestId} FOR UPDATE`;
  const req = await tx.maintenanceRequest.findUnique({ where: { id: requestId }, include: { resident: true } });
  // Same error for "missing" and "not yours".
  if (!req || req.residentId !== user.residentId) throw new NotFoundError("Request");
  return req;
}

export async function residentComment(user: ResidentUser, requestId: string, body: string, files: File[] = []): Promise<void> {
  await withPhotos(files, (photos) =>
    prisma.$transaction(async (tx) => {
      const req = await loadOwn(tx, user, requestId);
      if (req.status === "CANCELED") throw new UserError("This request was canceled. Submit a new request if you still need help.");
      await addPhotos(tx, req.id, photos, user.id);
      await tx.maintenanceUpdate.create({ data: { requestId: req.id, authorId: user.id, authorName: user.name, authorRole: "RESIDENT", body } });
      await tx.maintenanceRequest.update({ where: { id: req.id }, data: { updatedAt: new Date() } });
      await notifyAdmins(tx, {
        type: "MAINTENANCE_UPDATE",
        title: `Message on ${maintenanceRef(req.number)}`,
        body: `${req.resident.firstName} ${req.resident.lastName}: ${truncate(body, 140)}`,
        link: `/admin/maintenance/${req.id}`,
      });
    }),
  );
}

async function addPhotos(tx: Tx, requestId: string, photos: StoredPhoto[], uploadedBy: string) {
  if (!photos.length) return;
  const existing = await tx.maintenancePhoto.count({ where: { requestId } });
  if (existing + photos.length > MAX_MAINTENANCE_PHOTOS * 3) throw new UserError("This request already has the maximum number of photos", "photos");
  await tx.maintenancePhoto.createMany({
    data: photos.map((p) => ({ requestId, storageKey: p.key, mimeType: p.mime, sizeBytes: p.size, uploadedBy })),
  });
}

export async function residentCancel(user: ResidentUser, requestId: string, reason: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const req = await loadOwn(tx, user, requestId);
    if (!residentCanCancel(req.status)) throw new UserError("This repair is already underway — please message the office instead.");
    await tx.maintenanceRequest.update({ where: { id: req.id }, data: { status: "CANCELED", canceledAt: new Date() } });
    await tx.maintenanceUpdate.create({
      data: { requestId: req.id, authorId: user.id, authorName: user.name, authorRole: "RESIDENT", fromStatus: req.status, toStatus: "CANCELED", body: reason },
    });
    await audit(tx, { id: user.id, email: user.email, role: "RESIDENT" }, MAINTENANCE_AUDIT.canceled, "maintenance", req.id, { by: "resident", reason });
    await notifyAdmins(tx, {
      type: "MAINTENANCE_UPDATE",
      title: `${maintenanceRef(req.number)} canceled by resident`,
      body: `${req.resident.firstName} ${req.resident.lastName} canceled “${req.title}”.`,
      link: `/admin/maintenance/${req.id}`,
    });
  });
}

export async function residentReopen(user: ResidentUser, requestId: string, body: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const req = await loadOwn(tx, user, requestId);
    if (req.status !== "COMPLETED" || !req.completedAt) throw new UserError("Only completed requests can be reopened.");
    if (Date.now() - req.completedAt.getTime() > REOPEN_WINDOW_DAYS * 86_400_000)
      throw new UserError(`This was completed more than ${REOPEN_WINDOW_DAYS} days ago — please submit a new request.`);
    await tx.maintenanceRequest.update({ where: { id: req.id }, data: { status: "ACKNOWLEDGED", completedAt: null } });
    await tx.maintenanceUpdate.create({
      data: { requestId: req.id, authorId: user.id, authorName: user.name, authorRole: "RESIDENT", fromStatus: "COMPLETED", toStatus: "ACKNOWLEDGED", body },
    });
    await audit(tx, { id: user.id, email: user.email, role: "RESIDENT" }, MAINTENANCE_AUDIT.reopened, "maintenance", req.id, {});
    await notifyAdmins(tx, {
      type: "MAINTENANCE_UPDATE",
      title: `${maintenanceRef(req.number)} reopened`,
      body: `${req.resident.firstName} ${req.resident.lastName}: ${truncate(body, 140)}`,
      link: `/admin/maintenance/${req.id}`,
    });
  });
}

// ------------------------------------------------------------------ staff actions

export interface StaffUpdateInput {
  requestId: string;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  /** Wall-clock "YYYY-MM-DDTHH:mm" in the business timezone, or null to clear. */
  scheduledFor: string | null;
  assignedTo: string | null;
  body: string | null;
  internal: boolean;
}

export async function staffUpdate(actor: Actor & { name: string }, input: StaffUpdateInput, files: File[] = []): Promise<{ changed: boolean }> {
  const settings = await getSettings();
  return withPhotos(files, (photos) =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM maintenance_requests WHERE id = ${input.requestId} FOR UPDATE`;
      const req = await tx.maintenanceRequest.findUnique({ where: { id: input.requestId }, include: { resident: true } });
      if (!req) throw new NotFoundError("Request");

      const statusChanged = input.status !== req.status;
      if (statusChanged && !canMoveMaintenance(req.status, input.status))
        throw new UserError(`Can't move from ${MAINTENANCE_STATUS_LABELS[req.status]} to ${MAINTENANCE_STATUS_LABELS[input.status]}`, "status");
      const scheduledFor = input.scheduledFor ? zonedLocalToUtc(input.scheduledFor, settings.timezone) : null;
      const scheduleChanged = (scheduledFor?.getTime() ?? null) !== (req.scheduledFor?.getTime() ?? null);
      const priorityChanged = input.priority !== req.priority;
      const assigneeChanged = (input.assignedTo ?? null) !== (req.assignedTo ?? null);
      const hasBody = Boolean(input.body && input.body.trim());
      if (!statusChanged && !scheduleChanged && !priorityChanged && !assigneeChanged && !hasBody && photos.length === 0)
        throw new UserError("Nothing changed — update the status or add a note.");

      const data: Prisma.MaintenanceRequestUpdateInput = {
        status: input.status,
        priority: input.priority,
        scheduledFor,
        assignedTo: input.assignedTo,
        completedAt: input.status === "COMPLETED" ? (req.completedAt ?? new Date()) : null,
        canceledAt: input.status === "CANCELED" ? (req.canceledAt ?? new Date()) : null,
      };
      await tx.maintenanceRequest.update({ where: { id: req.id }, data });
      await addPhotos(tx, req.id, photos, actor.id);

      // A schedule/assignee change with no typed note still deserves a visible line.
      const autoNote = !hasBody && (scheduleChanged || assigneeChanged) && !statusChanged ? describeScheduleChange(scheduledFor, input.assignedTo, settings.timezone) : null;
      const internal = input.internal && hasBody && !statusChanged;
      await tx.maintenanceUpdate.create({
        data: {
          requestId: req.id,
          authorId: actor.id,
          authorName: actor.name,
          authorRole: "ADMIN",
          body: hasBody ? input.body : autoNote,
          fromStatus: statusChanged ? req.status : null,
          toStatus: statusChanged ? input.status : null,
          internal,
        },
      });
      await audit(tx, actor, MAINTENANCE_AUDIT.updated, "maintenance", req.id, {
        residentId: req.residentId,
        status: statusChanged ? { from: req.status, to: input.status } : undefined,
        priority: priorityChanged ? { from: req.priority, to: input.priority } : undefined,
        scheduledFor: scheduleChanged ? scheduledFor?.toISOString() ?? null : undefined,
        assignedTo: assigneeChanged ? input.assignedTo : undefined,
        note: hasBody ? (internal ? "internal" : "resident-visible") : undefined,
        photos: photos.length || undefined,
      });

      // Tell the resident about anything they can see.
      const visible = statusChanged || scheduleChanged || (hasBody && !internal) || photos.length > 0;
      if (visible && req.resident.userId && req.resident.status === "ACTIVE") {
        await notify(tx, {
          userId: req.resident.userId,
          type: "MAINTENANCE_UPDATE",
          title: statusChanged ? `Repair ${MAINTENANCE_STATUS_LABELS[input.status].toLowerCase()}: ${req.title}` : `Update on your repair: ${req.title}`,
          body:
            input.status === "SCHEDULED" && scheduledFor
              ? `Visit scheduled for ${formatWhen(scheduledFor, settings.timezone)}.${hasBody && !internal ? ` ${truncate(input.body!, 120)}` : ""}`
              : hasBody && !internal
                ? truncate(input.body!, 160)
                : `Status: ${MAINTENANCE_STATUS_LABELS[input.status]}.`,
          link: `/maintenance/${req.id}`,
        });
      }
      return { changed: true };
    }),
  );
}

function describeScheduleChange(when: Date | null, who: string | null, tz: string): string {
  const parts: string[] = [];
  parts.push(when ? `Visit set for ${formatWhen(when, tz)}` : "Visit time cleared");
  if (who) parts.push(`with ${who}`);
  return `${parts.join(" ")}.`;
}

export function formatWhen(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ------------------------------------------------------------------ queries

const photoSelect = { id: true, mimeType: true, createdAt: true, uploadedBy: true } satisfies Prisma.MaintenancePhotoSelect;

export async function listResidentRequests(residentId: string) {
  return prisma.maintenanceRequest.findMany({
    where: { residentId },
    orderBy: [{ updatedAt: "desc" }],
    include: { _count: { select: { photos: true } } },
  });
}

/** Resident view: internal staff notes are never returned. */
export async function getResidentRequest(residentId: string, requestId: string) {
  const req = await prisma.maintenanceRequest.findUnique({
    where: { id: requestId },
    include: {
      property: { select: { name: true } },
      room: { select: { name: true } },
      photos: { select: photoSelect, orderBy: { createdAt: "asc" } },
      updates: { where: { internal: false }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!req || req.residentId !== residentId) return null;
  return req;
}

export type MaintenanceFilters = {
  status?: MaintenanceStatus | "OPEN" | "ALL";
  propertyId?: string;
  priority?: MaintenancePriority;
  q?: string;
};

export async function listMaintenance(f: MaintenanceFilters) {
  const where: Prisma.MaintenanceRequestWhereInput = {};
  const status = f.status ?? "OPEN";
  if (status === "OPEN") where.status = { notIn: ["COMPLETED", "CANCELED"] };
  else if (status !== "ALL") where.status = status;
  if (f.propertyId) where.propertyId = f.propertyId;
  if (f.priority) where.priority = f.priority;
  if (f.q) {
    const q = f.q.trim();
    const num = Number(q.replace(/^MR-?/i, ""));
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { resident: { firstName: { contains: q, mode: "insensitive" } } },
      { resident: { lastName: { contains: q, mode: "insensitive" } } },
      ...(Number.isInteger(num) && num > 0 ? [{ number: num }] : []),
    ];
  }
  const rows = await prisma.maintenanceRequest.findMany({
    where,
    take: 300,
    include: {
      resident: { select: { id: true, firstName: true, lastName: true, isDemo: true } },
      property: { select: { name: true } },
      room: { select: { name: true } },
      _count: { select: { photos: true } },
    },
  });
  return rows.sort(compareQueue);
}

export async function maintenanceCounts() {
  const grouped = await prisma.maintenanceRequest.groupBy({ by: ["status", "priority"], _count: { _all: true } });
  let open = 0;
  let urgent = 0;
  let submitted = 0;
  const byStatus: Partial<Record<MaintenanceStatus, number>> = {};
  for (const g of grouped) {
    byStatus[g.status] = (byStatus[g.status] ?? 0) + g._count._all;
    if (isOpen(g.status)) {
      open += g._count._all;
      if (g.priority === "URGENT") urgent += g._count._all;
    }
    if (g.status === "SUBMITTED") submitted += g._count._all;
  }
  return { open, urgent, submitted, byStatus };
}

export async function getMaintenanceForStaff(requestId: string) {
  return prisma.maintenanceRequest.findUnique({
    where: { id: requestId },
    include: {
      resident: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, status: true, isDemo: true } },
      property: { select: { id: true, name: true, addressLine1: true } },
      room: { select: { id: true, name: true } },
      photos: { select: photoSelect, orderBy: { createdAt: "asc" } },
      updates: { orderBy: { createdAt: "asc" } },
    },
  });
}

/** Photo access: staff always; residents only for their own requests. */
export async function getPhotoForViewer(photoId: string, viewer: { role: "ADMIN" | "RESIDENT"; residentId: string | null }): Promise<MaintenancePhoto | null> {
  const photo = await prisma.maintenancePhoto.findUnique({ where: { id: photoId }, include: { request: { select: { residentId: true } } } });
  if (!photo) return null;
  if (viewer.role === "ADMIN") return photo;
  return viewer.residentId && photo.request.residentId === viewer.residentId ? photo : null;
}
