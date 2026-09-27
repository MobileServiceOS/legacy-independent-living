import type { Application } from "@prisma/client";
import { APPLICATION_STATUS_LABELS, canMoveApplication, type ApplicationStatus } from "../domain/applications";
import { dbDateFromDateOnly } from "../domain/dates";
import { audit, AUDIT_ACTIONS, type Actor } from "../lib/audit";
import { prisma } from "../lib/db";
import { notifyAdmins } from "../lib/notify";
import { NotFoundError, UserError } from "./errors";

export interface ApplicationInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredContact?: string | null;
  desiredMoveInDate: string | null;
  housingSituation?: string | null;
  isVeteran?: boolean | null;
  referralSource: string | null;
  message: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export async function submitApplication(input: ApplicationInput): Promise<Application> {
  return prisma.$transaction(async (tx) => {
    // Soft duplicate guard: same email with an open application in the last 24h.
    const recent = await tx.application.findFirst({
      where: {
        email: input.email,
        status: { in: ["NEW", "UNDER_REVIEW"] },
        createdAt: { gt: new Date(Date.now() - 86_400_000) },
      },
    });
    if (recent) return recent;
    const app = await tx.application.create({
      data: {
        ...input,
        preferredContact: input.preferredContact ?? null,
        housingSituation: input.housingSituation ?? null,
        isVeteran: input.isVeteran ?? null,
        desiredMoveInDate: input.desiredMoveInDate ? dbDateFromDateOnly(input.desiredMoveInDate) : null,
        consentAt: new Date(),
      },
    });
    await notifyAdmins(tx, {
      type: "APPLICATION_RECEIVED",
      title: "New application",
      body: `${input.firstName} ${input.lastName} applied for housing.`,
      link: `/admin/applications/${app.id}`,
      dedupeKey: `application-received:${app.id}`,
    });
    return app;
  });
}

export async function setApplicationStatus(
  actor: Actor,
  input: { applicationId: string; status: ApplicationStatus; reviewNotes: string | null },
): Promise<void> {
  if (input.status === "CONVERTED") throw new UserError("Use “Convert to resident” to place an applicant");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM applications WHERE id = ${input.applicationId} FOR UPDATE`;
    const app = await tx.application.findUnique({ where: { id: input.applicationId } });
    if (!app) throw new NotFoundError("Application");
    const statusChanged = app.status !== input.status;
    if (statusChanged && !canMoveApplication(app.status, input.status))
      throw new UserError(`Can't move from ${APPLICATION_STATUS_LABELS[app.status]} to ${APPLICATION_STATUS_LABELS[input.status]}`);
    await tx.application.update({
      where: { id: app.id },
      data: {
        status: input.status,
        reviewNotes: input.reviewNotes,
        reviewedById: actor.id,
        decidedAt: statusChanged && ["APPROVED", "DECLINED"].includes(input.status) ? new Date() : app.decidedAt,
      },
    });
    await audit(tx, actor, AUDIT_ACTIONS.applicationStatusChanged, "application", app.id, {
      from: app.status,
      to: input.status,
      notesChanged: (app.reviewNotes ?? null) !== input.reviewNotes,
    });
  });
}
