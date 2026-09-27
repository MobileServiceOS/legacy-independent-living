"use server";
/**
 * Admin server actions. Each one: authorize (permission) → validate (zod) →
 * call a transactional service (which audits) → revalidate affected pages.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/actions";
import { actorOf, requireActionPermission } from "@/lib/auth/session";
import {
  announcementSchema,
  applicationStatusSchema,
  documentSchema,
  id,
  ledgerEntrySchema,
  moveOutSchema,
  offlinePaymentSchema,
  placementSchema,
  propertySchema,
  refundSchema,
  rentChangeSchema,
  residentEditSchema,
  roomSchema,
  roomStatusSchema,
  settingsSchema,
  transferSchema,
} from "@/lib/validation";
import { setApplicationStatus } from "@/server/applications";
import { addDocument, archiveDocument } from "@/server/documents";
import { UserError } from "@/server/errors";
import { sendAnnouncement } from "@/server/notifications";
import { recordOfflinePayment, refundPayment, simulateAchResult } from "@/server/payments";
import { saveProperty, saveRoom, setRoomStatus } from "@/server/properties";
import { runRentEngine } from "@/server/rent-engine";
import {
  addManualLedgerEntry,
  changeRent,
  moveOutResident,
  placeResident,
  reissueInvite,
  transferRoom,
  updateResident,
} from "@/server/residents";
import { updateSettings } from "@/server/settings";

const refreshAdmin = () => revalidatePath("/admin", "layout");

// ------------------------------------------------------------ properties & rooms

export async function savePropertyAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, propertySchema, async ({ propertyId, ...input }) => {
    const user = await requireActionPermission("properties:write");
    const p = await saveProperty(actorOf(user), propertyId, input);
    refreshAdmin();
    return propertyId ? { message: "Property saved." } : { redirectTo: `/admin/properties/${p.id}` };
  });
}

export async function saveRoomAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, roomSchema, async (input) => {
    const user = await requireActionPermission("properties:write");
    await saveRoom(actorOf(user), input);
    refreshAdmin();
    return { message: input.roomId ? "Room saved." : `${input.name} added.` };
  });
}

export async function setRoomStatusAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, roomStatusSchema, async ({ roomId, status }) => {
    const user = await requireActionPermission("properties:write");
    await setRoomStatus(actorOf(user), roomId, status as "AVAILABLE" | "RESERVED" | "MAINTENANCE");
    refreshAdmin();
    return { message: "Room status updated." };
  });
}

// ------------------------------------------------------------ residents

export async function placeResidentAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, placementSchema, async (input) => {
    const user = await requireActionPermission("residents:write");
    const { residentId, inviteUrl } = await placeResident(actorOf(user), input);
    refreshAdmin();
    return {
      message: `${input.firstName} ${input.lastName} is now a resident. Share the setup link below so they can sign in.`,
      data: { inviteUrl, residentUrl: `/admin/residents/${residentId}` },
    };
  });
}

export async function updateResidentAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, residentEditSchema, async (input) => {
    const user = await requireActionPermission("residents:write");
    await updateResident(actorOf(user), input);
    refreshAdmin();
    return { message: "Resident details saved." };
  });
}

export async function transferRoomAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, transferSchema, async (input) => {
    const user = await requireActionPermission("residents:write");
    await transferRoom(actorOf(user), input);
    refreshAdmin();
    return { message: "Room transfer saved." };
  });
}

export async function changeRentAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, rentChangeSchema, async (input) => {
    const user = await requireActionPermission("residents:write");
    await changeRent(actorOf(user), input);
    refreshAdmin();
    return { message: "Rent updated. New charges will use the new amount." };
  });
}

export async function addLedgerEntryAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, ledgerEntrySchema, async (input) => {
    const user = await requireActionPermission("ledger:write");
    await addManualLedgerEntry(actorOf(user), input);
    refreshAdmin();
    return { message: "Ledger entry posted." };
  });
}

export async function moveOutAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, moveOutSchema.extend({ confirm: z.literal("on", { errorMap: () => ({ message: "Please confirm the move-out" }) }) }), async ({ confirm: _c, ...input }) => {
    const user = await requireActionPermission("residents:write");
    await moveOutResident(actorOf(user), input);
    refreshAdmin();
    return { message: "Resident moved out. Their room is available and their history is kept." };
  });
}

export async function reissueInviteAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, z.object({ residentId: id }), async ({ residentId }) => {
    const user = await requireActionPermission("residents:write");
    const inviteUrl = await reissueInvite(actorOf(user), residentId);
    return { message: "New setup link created. Earlier links no longer work.", data: { inviteUrl } };
  });
}

// ------------------------------------------------------------ payments

export async function recordOfflinePaymentAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, offlinePaymentSchema, async (input) => {
    const user = await requireActionPermission("payments:record");
    const p = await recordOfflinePayment(actorOf(user), input);
    refreshAdmin();
    return { message: `Payment recorded — receipt ${p.receiptNumber}.`, data: { receiptUrl: `/receipts/${p.id}` } };
  });
}

export async function refundPaymentAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, refundSchema.extend({ confirm: z.literal("on", { errorMap: () => ({ message: "Please confirm the refund" }) }) }), async ({ paymentId, reason }) => {
    const user = await requireActionPermission("payments:refund");
    await refundPayment(actorOf(user), { paymentId, reason });
    refreshAdmin();
    return { message: "Payment refunded and the ledger updated." };
  });
}

export async function simulateAchAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, z.object({ paymentId: id, result: z.enum(["cleared", "returned"]) }), async ({ paymentId, result }) => {
    const user = await requireActionPermission("payments:record");
    await simulateAchResult(actorOf(user), paymentId, result === "cleared");
    refreshAdmin();
    return { message: result === "cleared" ? "Sandbox ACH cleared." : "Sandbox ACH returned." };
  });
}

// ------------------------------------------------------------ applications

export async function setApplicationStatusAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, applicationStatusSchema, async (input) => {
    const user = await requireActionPermission("applications:write");
    await setApplicationStatus(actorOf(user), input);
    refreshAdmin();
    return { message: "Application updated." };
  });
}

// ------------------------------------------------------------ documents

export async function addDocumentAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, documentSchema, async (input) => {
    const user = await requireActionPermission("documents:write");
    const file = fd.get("file");
    await addDocument(actorOf(user), { ...input, file: file instanceof File ? file : null });
    refreshAdmin();
    return { message: "Document added." };
  });
}

export async function archiveDocumentAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, z.object({ documentId: id }), async ({ documentId }) => {
    const user = await requireActionPermission("documents:write");
    await archiveDocument(actorOf(user), documentId);
    refreshAdmin();
    return { message: "Document removed from the resident's list (kept in history)." };
  });
}

// ------------------------------------------------------------ settings, rent engine, announcements

export async function updateSettingsAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, settingsSchema, async (input) => {
    const user = await requireActionPermission("settings:write");
    if (input.allowPartialPayments && input.minPartialPayment < 100) throw new UserError("Minimum partial payment must be at least $1.00", "minPartialPayment");
    await updateSettings(actorOf(user), input);
    revalidatePath("/", "layout");
    return { message: "Settings saved." };
  });
}

export async function runRentEngineAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, z.object({}), async () => {
    const user = await requireActionPermission("ledger:write");
    const r = await runRentEngine({ actor: actorOf(user) });
    refreshAdmin();
    return {
      message: `Rent engine ran for ${r.today}: ${r.chargesPosted} rent charge(s), ${r.lateFeesPosted} late fee(s), ${r.remindersSent} reminder(s).${r.failures ? ` ${r.failures} resident(s) failed — see server logs.` : ""}`,
    };
  });
}

export async function sendAnnouncementAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, announcementSchema, async (input) => {
    const user = await requireActionPermission("notifications:broadcast");
    const { recipients } = await sendAnnouncement(actorOf(user), input);
    refreshAdmin();
    return { message: `Announcement sent to ${recipients} resident${recipients === 1 ? "" : "s"}.` };
  });
}
