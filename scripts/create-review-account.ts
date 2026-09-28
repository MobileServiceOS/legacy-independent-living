/**
 * App Store review account — a resident login Apple's reviewers can use.
 *
 *   REVIEW_PASSWORD='a-long-passphrase-1' npm run review:account
 *   (optional) REVIEW_EMAIL=appreview@legacyindependentliving.net
 *
 * Creates (once) a clearly-labelled test home "App Review test home (not a real
 * home)" with one room, and a resident in it with $1.00/month rent and a $1.00
 * sample charge, so the reviewer sees a balance, can open Stripe checkout, file a
 * repair with a photo, and turn on notifications. Everything is flagged isDemo,
 * so it's tagged "Demo" in lists and left out of the owner's dashboard/report
 * totals. Safe to re-run: it just resets the password and tops the balance up.
 */
import { prisma } from "../src/lib/db";
import { hashPassword, validatePasswordStrength } from "../src/lib/security/crypto";
import { addManualLedgerEntry, defaultToday, placeResident } from "../src/server/residents";
import { residentFinancials } from "../src/server/ledger";

const HOME = "App Review test home (not a real home)";

async function main() {
  const email = (process.env.REVIEW_EMAIL ?? "appreview@legacyindependentliving.net").trim().toLowerCase();
  const password = process.env.REVIEW_PASSWORD ?? "";
  const weak = validatePasswordStrength(password);
  if (weak) throw new Error(`REVIEW_PASSWORD: ${weak}`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("Create the owner account first (npm run owner:create)");
  const actor = { id: admin.id, email: admin.email, role: "ADMIN" as const };
  const today = await defaultToday();

  let property = await prisma.property.findFirst({ where: { name: HOME, isDemo: true, archivedAt: null } });
  property ??= await prisma.property.create({
    data: { name: HOME, addressLine1: "For Apple App Review only", city: "Houston", state: "TX", postalCode: "77002", isDemo: true, notes: "Test home for the App Store review account. Not a real property." },
  });
  let room = await prisma.room.findFirst({ where: { propertyId: property.id } });
  room ??= await prisma.room.create({ data: { propertyId: property.id, name: "Room A", defaultRentCents: 100, isDemo: true } });

  let user = await prisma.user.findUnique({ where: { email }, include: { resident: true } });
  if (user && user.role !== "RESIDENT") throw new Error(`${email} is a staff account — pick another REVIEW_EMAIL`);
  if (!user) {
    await placeResident(actor, {
      firstName: "App",
      lastName: "Reviewer",
      email,
      phone: "555-555-0100",
      emergencyContactName: null,
      emergencyContactPhone: null,
      emergencyContactRelation: null,
      notes: "Apple App Review account — not a real resident.",
      roomId: room.id,
      monthlyRent: 100,
      moveInDate: today,
      dueDay: 1,
    });
    user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { resident: true } });
  }
  const resident = user.resident!;
  await prisma.resident.update({ where: { id: resident.id }, data: { isDemo: true } });
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), status: "ACTIVE" } });
  await prisma.inviteToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.session.deleteMany({ where: { userId: user.id } });

  const { position } = await residentFinancials(prisma, resident.id, today);
  if (position.balanceCents - position.pendingCents <= 0)
    await addManualLedgerEntry(actor, { residentId: resident.id, kind: "OTHER_CHARGE", amount: 100, effectiveDate: today, description: "Sample charge for App Review" });

  await prisma.auditLog.create({ data: { actorEmail: "cli", action: "review_account.ready", entityType: "user", entityId: user.id } });
  console.log(`✔ App Review account ready: ${email} (password as set). Home: "${HOME}" — excluded from owner totals.`);
  console.log("  App Store Connect → App Review Information → Sign-in required: enter this email + password.");
}

main()
  .catch((e) => {
    console.error(`✖ ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
