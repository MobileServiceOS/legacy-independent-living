"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/actions";
import { actorOf, getSessionUser, requireActionPermission } from "@/lib/auth/session";
import { limiters } from "@/lib/security/rate-limit";
import { id, maintenanceCommentSchema, maintenanceRequestSchema, maintenanceStaffUpdateSchema } from "@/lib/validation";
import { ForbiddenError, UserError } from "@/server/errors";
import { residentCancel, residentComment, residentReopen, staffUpdate, submitMaintenanceRequest } from "@/server/maintenance";

function photosOf(fd: FormData): File[] {
  return fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
}

async function requireResidentMaintenance() {
  const user = await getSessionUser();
  if (!user || user.role !== "RESIDENT" || !user.residentId) throw new ForbiddenError();
  return user as typeof user & { residentId: string };
}

function refresh(requestId?: string) {
  revalidatePath("/maintenance");
  revalidatePath("/admin/maintenance");
  if (requestId) {
    revalidatePath(`/maintenance/${requestId}`);
    revalidatePath(`/admin/maintenance/${requestId}`);
  }
}

// ------------------------------------------------------------------ resident

export async function submitMaintenanceAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, maintenanceRequestSchema, async (input) => {
    const user = await requireResidentMaintenance();
    if (!limiters.maintenance.hit(user.id).allowed) throw new UserError("You've sent several requests just now. Please call the office if it's urgent.");
    const req = await submitMaintenanceRequest(user, input, photosOf(fd));
    refresh();
    return { redirectTo: `/maintenance/${req.id}?submitted=1` };
  });
}

export async function maintenanceCommentAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, maintenanceCommentSchema, async ({ requestId, body }) => {
    const user = await requireResidentMaintenance();
    if (!limiters.maintenance.hit(user.id).allowed) throw new UserError("Too many messages at once — please wait a few minutes.");
    await residentComment(user, requestId, body, photosOf(fd));
    refresh(requestId);
    return { message: "Message sent to the office." };
  });
}

export async function cancelMaintenanceAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  const schema = z.object({
    requestId: id,
    reason: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
    confirm: z.literal("on", { errorMap: () => ({ message: "Please confirm" }) }),
  });
  return runAction(prev, fd, schema, async ({ requestId, reason }) => {
    const user = await requireResidentMaintenance();
    await residentCancel(user, requestId, reason);
    refresh(requestId);
    return { message: "Request canceled." };
  });
}

export async function reopenMaintenanceAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, maintenanceCommentSchema, async ({ requestId, body }) => {
    const user = await requireResidentMaintenance();
    await residentReopen(user, requestId, body);
    refresh(requestId);
    return { message: "Request reopened. The office has been notified." };
  });
}

// ------------------------------------------------------------------ staff

export async function staffMaintenanceUpdateAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(prev, fd, maintenanceStaffUpdateSchema, async (input) => {
    const user = await requireActionPermission("maintenance:write");
    await staffUpdate({ ...actorOf(user), name: user.name }, input, photosOf(fd));
    refresh(input.requestId);
    revalidatePath("/admin", "layout");
    return { message: "Request updated." };
  });
}
