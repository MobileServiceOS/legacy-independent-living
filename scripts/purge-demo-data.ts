/**
 * Remove demo data from production while keeping the Apple App Review account
 * (created by `review:account`) fully intact.
 *
 * Deletes, for every isDemo property/resident EXCEPT the one tied to KEEP_EMAIL:
 * maintenance requests (+ updates/photos), documents, payment events, ledger
 * entries, payments, payment methods, room assignments, rent schedules, the
 * resident, its application (if any), its login (sessions/notifications/push
 * devices cascade), the room, and the property (+ its announcements). Also
 * removes the `db:seed` demo owner account (owner@legacy.demo by default) if
 * present — never any other ADMIN account.
 *
 * Safe by default: prints exactly what it found and does NOT delete anything
 * unless you pass CONFIRM=yes.
 *
 *   npm run demo:purge                     # dry run — just reports
 *   CONFIRM=yes npm run demo:purge         # actually deletes
 *   KEEP_EMAIL=other@example.com CONFIRM=yes npm run demo:purge
 */
import { prisma } from "../src/lib/db";

const KEEP_EMAIL = (process.env.KEEP_EMAIL ?? "appreview@legacyindependentliving.net").trim().toLowerCase();
const SEED_ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? "owner@legacy.demo").trim().toLowerCase();
const CONFIRM = process.env.CONFIRM === "yes";

async function purgeResident(residentId: string) {
  const requestIds = (await prisma.maintenanceRequest.findMany({ where: { residentId }, select: { id: true } })).map((r) => r.id);
  if (requestIds.length) {
    await prisma.maintenanceUpdate.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.maintenancePhoto.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: requestIds } } });
  }
  await prisma.document.deleteMany({ where: { residentId } });

  const paymentIds = (await prisma.payment.findMany({ where: { residentId }, select: { id: true } })).map((p) => p.id);
  if (paymentIds.length) await prisma.paymentEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });

  // Ledger entries can self-reference (a refund pointing back at its original payment
  // entry) — null those out first so the delete isn't blocked by its own rows.
  await prisma.ledgerEntry.updateMany({ where: { residentId }, data: { relatedEntryId: null } });
  await prisma.ledgerEntry.deleteMany({ where: { residentId } });
  if (paymentIds.length) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.paymentMethod.deleteMany({ where: { residentId } });
  await prisma.roomAssignment.deleteMany({ where: { residentId } });
  await prisma.rentSchedule.deleteMany({ where: { residentId } });

  const resident = await prisma.resident.findUniqueOrThrow({ where: { id: residentId } });
  await prisma.resident.delete({ where: { id: residentId } });
  if (resident.applicationId) await prisma.application.delete({ where: { id: resident.applicationId } }).catch(() => {});
  // Cascades to that user's sessions, notifications and push devices.
  if (resident.userId) await prisma.user.delete({ where: { id: resident.userId } }).catch(() => {});
}

async function main() {
  const keepResident = await prisma.resident.findFirst({ where: { email: KEEP_EMAIL }, include: { assignments: { include: { room: true } } } });
  const keepPropertyId = keepResident?.assignments[0]?.room.propertyId;
  if (!keepResident) console.log(`Note: no resident found for KEEP_EMAIL ${KEEP_EMAIL} — nothing will be preserved by that name.`);

  const demoResidents = await prisma.resident.findMany({ where: { isDemo: true, id: { not: keepResident?.id } }, select: { id: true, firstName: true, lastName: true, email: true } });
  const demoProperties = await prisma.property.findMany({ where: { isDemo: true, id: { not: keepPropertyId } }, select: { id: true, name: true } });
  const standaloneApps = await prisma.application.findMany({ where: { isDemo: true, resident: null }, select: { id: true, firstName: true, lastName: true } });
  const seedAdmin = await prisma.user.findUnique({ where: { email: SEED_ADMIN_EMAIL } });

  console.log(`Keeping: ${keepResident ? `${keepResident.firstName} ${keepResident.lastName} <${KEEP_EMAIL}>` : "(none found)"}${keepPropertyId ? ` in property ${keepPropertyId}` : ""}`);
  console.log(`Demo residents to remove (${demoResidents.length}):`, demoResidents.map((r) => `${r.firstName} ${r.lastName} <${r.email}>`));
  console.log(`Demo properties to remove (${demoProperties.length}):`, demoProperties.map((p) => p.name));
  console.log(`Standalone demo applications to remove (${standaloneApps.length}):`, standaloneApps.map((a) => `${a.firstName} ${a.lastName}`));
  console.log(`Seed admin to remove: ${seedAdmin ? SEED_ADMIN_EMAIL : "(none found)"}`);

  if (!CONFIRM) {
    console.log("\nDry run only — nothing deleted. Re-run with CONFIRM=yes to actually delete the above.");
    return;
  }

  for (const r of demoResidents) await purgeResident(r.id);
  for (const a of standaloneApps) await prisma.application.delete({ where: { id: a.id } }).catch(() => {});

  for (const p of demoProperties) {
    await prisma.announcement.deleteMany({ where: { propertyId: p.id } });
    await prisma.maintenanceRequest.deleteMany({ where: { propertyId: p.id } }); // any left with no resident tie
    await prisma.room.deleteMany({ where: { propertyId: p.id } });
    await prisma.property.delete({ where: { id: p.id } });
  }

  if (seedAdmin && seedAdmin.role === "ADMIN") await prisma.user.delete({ where: { id: seedAdmin.id } });

  await prisma.auditLog.create({
    data: {
      actorEmail: "cli",
      action: "demo.purged",
      entityType: "system",
      metadata: { keptEmail: keepResident ? KEEP_EMAIL : null, residentsRemoved: demoResidents.length, propertiesRemoved: demoProperties.length },
    },
  });
  console.log("\nDone. Demo data removed; the App Review account is untouched.");
}

main()
  .catch((e) => {
    console.error(`✖ ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
