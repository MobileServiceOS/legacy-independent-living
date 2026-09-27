import type { Prisma } from "@prisma/client";
import type { Db } from "./db";

export interface Actor {
  id: string;
  email: string;
  role: "ADMIN" | "RESIDENT" | "SYSTEM";
}

export const SYSTEM_ACTOR: Actor = { id: "system", email: "system", role: "SYSTEM" };

/**
 * Append an audit record. Call inside the same transaction as the change so
 * the log and the data can never disagree.
 */
export async function audit(
  db: Db,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
  ip?: string | null,
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: actor.role === "SYSTEM" ? null : actor.id,
      actorEmail: actor.email,
      action,
      entityType,
      entityId,
      metadata: metadata as Prisma.InputJsonValue,
      ip: ip ?? null,
    },
  });
}

export const AUDIT_ACTIONS = {
  residentCreated: "resident.created",
  residentEdited: "resident.edited",
  residentMovedOut: "resident.moved_out",
  roomAssigned: "room.assigned",
  roomTransferred: "room.transferred",
  roomStatusChanged: "room.status_changed",
  roomCreated: "room.created",
  roomEdited: "room.edited",
  propertyCreated: "property.created",
  propertyEdited: "property.edited",
  rentChanged: "rent.changed",
  chargeAdded: "ledger.charge_added",
  creditIssued: "ledger.credit_issued",
  adjustmentPosted: "ledger.adjustment_posted",
  manualPaymentRecorded: "payment.manual_recorded",
  paymentRefunded: "payment.refunded",
  applicationStatusChanged: "application.status_changed",
  applicationConverted: "application.converted",
  inviteIssued: "user.invite_issued",
  documentAdded: "document.added",
  documentArchived: "document.archived",
  settingsChanged: "settings.changed",
  announcementSent: "announcement.sent",
  rentEngineRun: "rent_engine.run",
  loginSucceeded: "auth.login",
} as const;
