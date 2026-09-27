/**
 * DEMO seed. Every record is flagged isDemo and uses fictional names and
 * example addresses — NOT real Legacy Independent Living residents or homes.
 * Dates are relative to "today" so the demo always shows every rent status.
 *
 *   npm run db:seed             (refuses to run if properties already exist)
 *   SEED_ADMIN_PASSWORD=... npm run db:seed
 */
import { addDays, addMonths, dbDateFromDateOnly, parseDateOnly, toDateOnly, type DateOnly } from "../src/domain/dates";
import { makeReceiptNumber, type PaymentMethodType } from "../src/domain/payments";
import type { Actor } from "../src/lib/audit";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/security/crypto";
import { businessToday, getSettings } from "../src/lib/settings";
import { submitApplication } from "../src/server/applications";
import { postLedgerEntry } from "../src/server/ledger";
import { moveOutResident, placeResident } from "../src/server/residents";
import { recordOfflinePayment } from "../src/server/payments";
import { runRentEngine, runRentEngineForResident } from "../src/server/rent-engine";
import { staffUpdate, submitMaintenanceRequest } from "../src/server/maintenance";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "owner@legacy.demo";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "LegacyDemo2026!";
const RESIDENT_PASSWORD = process.env.SEED_RESIDENT_PASSWORD ?? "ResidentDemo2026!";

async function main() {
  if ((await prisma.property.count()) > 0) {
    console.log("Properties already exist — seed skipped (it only runs on an empty database).");
    return;
  }
  const settings = await getSettings();
  const today = businessToday(settings);
  const { y, m } = parseDateOnly(today);
  /** 1st of the month `offset` months from now (0 = this month). */
  const first = (offset: number, day = 1): DateOnly => {
    const ym = addMonths(y, m, offset);
    return toDateOnly(ym.y, ym.m, day);
  };
  console.log(`Seeding demo data relative to ${today}…`);
  // Make sure next month's rent is already posted so every rent status is visible,
  // whatever day of the month the seed runs (the engine normally posts 7 days ahead).
  const nextDue = first(1);
  const postThrough = addDays(nextDue, -7) > today ? addDays(nextDue, -7) : today;

  // Late fees stay off while back-filling history (payments are added after charges);
  // they're switched on at the end so only genuinely late rent gets a fee.
  await prisma.settings.update({
    where: { id: 1 },
    data: { lateFeeCents: 0, graceDays: 5, chargeLeadDays: 7, supportPhone: "(555) 010-0100", supportEmail: "office@legacy.demo" },
  });

  const admin = await prisma.user.create({
    data: { email: ADMIN_EMAIL, name: "Demo Owner", role: "ADMIN", status: "ACTIVE", passwordHash: await hashPassword(ADMIN_PASSWORD) },
  });
  const actor: Actor = { id: admin.id, email: admin.email, role: "ADMIN" };

  // ------------------------------------------------------------ properties & rooms
  const house1 = await prisma.property.create({
    data: { name: "Legacy House #1", addressLine1: "100 Example Ave (demo)", city: "Houston", state: "TX", postalCode: "77000", isDemo: true, notes: "Demo property" },
  });
  const house2 = await prisma.property.create({
    data: { name: "Legacy House #2", addressLine1: "200 Sample St (demo)", city: "Houston", state: "TX", postalCode: "77000", isDemo: true, notes: "Demo property" },
  });
  const room = async (propertyId: string, name: string, rent: number, status: "AVAILABLE" | "RESERVED" | "MAINTENANCE" = "AVAILABLE") =>
    prisma.room.create({ data: { propertyId, name, defaultRentCents: rent, status, isDemo: true } });

  const h1 = {
    r1: await room(house1.id, "Room 1", 75000),
    r2: await room(house1.id, "Room 2", 75000),
    r3: await room(house1.id, "Room 3", 75000), // left AVAILABLE for the walkthrough scenario
    r4: await room(house1.id, "Room 4", 70000),
    r5: await room(house1.id, "Room 5", 70000, "RESERVED"),
    r6: await room(house1.id, "Room 6", 72500),
  };
  const h2 = {
    a: await room(house2.id, "Room A", 72500),
    b: await room(house2.id, "Room B", 72500),
    c: await room(house2.id, "Room C", 70000),
    d: await room(house2.id, "Room D", 70000, "MAINTENANCE"),
    e: await room(house2.id, "Room E", 70000),
  };

  // ------------------------------------------------------------ residents
  const passwordHash = await hashPassword(RESIDENT_PASSWORD);
  async function resident(p: { first: string; last: string; email: string; phone: string; roomId: string; rent: number; moveIn: DateOnly }) {
    const { residentId } = await placeResident(actor, {
      firstName: p.first,
      lastName: p.last,
      email: p.email,
      phone: p.phone,
      emergencyContactName: "Demo Contact",
      emergencyContactPhone: "(555) 010-9999",
      emergencyContactRelation: "Family",
      notes: null,
      roomId: p.roomId,
      monthlyRent: p.rent,
      moveInDate: p.moveIn,
      dueDay: 1,
    });
    await runRentEngineForResident(prisma, residentId, postThrough);
    const r = await prisma.resident.update({ where: { id: residentId }, data: { isDemo: true } });
    await prisma.user.update({ where: { id: r.userId! }, data: { status: "ACTIVE", passwordHash } });
    await prisma.inviteToken.updateMany({ where: { userId: r.userId! }, data: { usedAt: new Date() } });
    return residentId;
  }

  let receiptSeq = 0;
  /** A settled historical online payment (sandbox provider), dated in the past. */
  async function paid(residentId: string, amount: number, date: DateOnly, method: PaymentMethodType = "DEBIT_CARD") {
    const p = await prisma.payment.create({
      data: {
        residentId,
        amountCents: amount,
        method,
        status: "SUCCEEDED",
        provider: "MOCK",
        providerRef: `mock_seed_${residentId}_${++receiptSeq}`,
        receiptNumber: `${makeReceiptNumber(date)}${receiptSeq}`,
        paidOn: dbDateFromDateOnly(date),
        processedAt: new Date(`${date}T15:00:00Z`),
        last4: method === "ACH" ? "6789" : "4242",
        cardBrand: method === "ACH" ? null : "Visa",
      },
    });
    await postLedgerEntry(prisma, null, {
      residentId,
      type: "PAYMENT",
      amountCents: -amount,
      description: `Online payment — receipt ${p.receiptNumber}`,
      effectiveDate: date,
      paymentId: p.id,
      idempotencyKey: `payment:${p.id}`,
    });
    return p;
  }

  // 1) PAID — paid every month, including next month's rent early.
  const marcus = await resident({ first: "Marcus", last: "Bell", email: "marcus.bell@legacy.demo", phone: "(555) 010-1001", roomId: h1.r1.id, rent: 75000, moveIn: first(-3) });
  for (const o of [-3, -2, -1, 0]) await paid(marcus, 75000, first(o, 1));
  await paid(marcus, 75000, addDays(today, -1));

  // 2) RENT DUE (due soon) — current through this month; next month's rent is posted and open.
  const angela = await resident({ first: "Angela", last: "Price", email: "angela.price@legacy.demo", phone: "(555) 010-1002", roomId: h1.r2.id, rent: 75000, moveIn: first(-2) });
  for (const o of [-2, -1, 0]) await paid(angela, 75000, first(o, 2), "CREDIT_CARD");

  // 3) PARTIAL — paid part of next month's rent.
  const terrence = await resident({ first: "Terrence", last: "Hall", email: "terrence.hall@legacy.demo", phone: "(555) 010-1003", roomId: h1.r4.id, rent: 70000, moveIn: first(-1) });
  for (const o of [-1, 0]) await paid(terrence, 70000, first(o, 1));
  await paid(terrence, 30000, addDays(today, -2));

  // 4) OVERDUE — this month's rent never paid.
  const denise = await resident({ first: "Denise", last: "Carter", email: "denise.carter@legacy.demo", phone: "(555) 010-1004", roomId: h1.r6.id, rent: 72500, moveIn: first(-2) });
  for (const o of [-2, -1]) await paid(denise, 72500, first(o, 3));

  // 5) PENDING — bank (ACH) payment in flight for next month.
  const luis = await resident({ first: "Luis", last: "Ramirez", email: "luis.ramirez@legacy.demo", phone: "(555) 010-1005", roomId: h2.a.id, rent: 72500, moveIn: first(-1) });
  for (const o of [-1, 0]) await paid(luis, 72500, first(o, 1), "ACH");
  await prisma.payment.create({
    data: {
      residentId: luis,
      amountCents: 72500,
      method: "ACH",
      status: "PROCESSING",
      provider: "MOCK",
      providerRef: `mock_seed_ach_${luis}`,
      receiptNumber: `${makeReceiptNumber(today)}P`,
      initiatedById: (await prisma.resident.findUniqueOrThrow({ where: { id: luis } })).userId,
    },
  });

  // 6) PAID by money order (offline, recorded by the owner).
  const gloria = await resident({ first: "Gloria", last: "James", email: "gloria.james@legacy.demo", phone: "(555) 010-1006", roomId: h2.b.id, rent: 72500, moveIn: first(-4) });
  for (const o of [-4, -3, -2, -1, 0]) {
    await recordOfflinePayment(actor, { residentId: gloria, amount: 72500, paidOn: first(o, 1), method: "MONEY_ORDER", reference: `MO #${48210 + o}`, note: "Demo" });
  }
  await recordOfflinePayment(actor, { residentId: gloria, amount: 72500, paidOn: addDays(today, -3), method: "MONEY_ORDER", reference: "MO #48215", note: "Demo — paid early" });

  // 7) MOVED OUT — history kept, small balance left.
  const kevin = await resident({ first: "Kevin", last: "Ortiz", email: "kevin.ortiz@legacy.demo", phone: "(555) 010-1007", roomId: h2.e.id, rent: 70000, moveIn: first(-5) });
  for (const o of [-5, -4, -3, -2]) await paid(kevin, 70000, first(o, 1));
  await paid(kevin, 55000, first(-1, 4));
  await moveOutResident(actor, { residentId: kevin, moveOutDate: first(-1, 15), reason: "Moved in with family (demo)" });

  // ------------------------------------------------------------ maintenance requests (demo)
  const asResident = async (residentId: string) => {
    const r = await prisma.resident.findUniqueOrThrow({ where: { id: residentId }, include: { user: true } });
    return { id: r.userId!, name: r.user!.name, email: r.email, residentId };
  };
  const staff = { ...actor, name: "Demo Owner" };
  const leak = await submitMaintenanceRequest(await asResident(angela), {
    category: "PLUMBING",
    priority: "URGENT",
    title: "Bathroom sink is leaking",
    description: "Water is pooling under the sink in the shared bathroom. I put a towel down.",
    location: "Shared bathroom, 2nd floor",
    permissionToEnter: true,
    entryNotes: "Please knock first.",
  });
  await staffUpdate(staff, { requestId: leak.id, status: "SCHEDULED", priority: "URGENT", scheduledFor: `${addDays(today, 1)}T09:30`, assignedTo: "Handyman (demo)", body: "Thanks for letting us know — a handyman is coming tomorrow morning.", internal: false });
  await submitMaintenanceRequest(await asResident(terrence), {
    category: "HEATING_COOLING",
    priority: "NORMAL",
    title: "AC not cooling in my room",
    description: "The air blows but it isn't cold, started two days ago.",
    location: "My room",
    permissionToEnter: false,
    entryNotes: null,
  });
  const lock = await submitMaintenanceRequest(await asResident(marcus), {
    category: "DOORS_LOCKS",
    priority: "LOW",
    title: "Front door lock sticks",
    description: "Key is hard to turn in the front door lock.",
    location: "Front door",
    permissionToEnter: true,
    entryNotes: null,
  });
  await staffUpdate(staff, { requestId: lock.id, status: "COMPLETED", priority: "LOW", scheduledFor: null, assignedTo: null, body: "Lubricated and adjusted the lock. Let us know if it sticks again.", internal: false });

  // ------------------------------------------------------------ applicants
  const apps = [
    { firstName: "Jordan", lastName: "Ellis", email: "jordan.ellis@legacy.demo", phone: "(555) 010-2001", status: "APPROVED" as const, housingSituation: "Staying with family or friends", isVeteran: true, desiredMoveInDate: first(1) },
    { firstName: "Renee", lastName: "Foster", email: "renee.foster@legacy.demo", phone: "(555) 010-2002", status: "NEW" as const, housingSituation: "In a shelter or transitional program", isVeteran: false, desiredMoveInDate: addDays(today, 14) },
    { firstName: "Samuel", lastName: "Greene", email: "samuel.greene@legacy.demo", phone: "(555) 010-2003", status: "NEW" as const, housingSituation: "Currently without housing", isVeteran: true, desiredMoveInDate: null },
    { firstName: "Tasha", lastName: "Moore", email: "tasha.moore@legacy.demo", phone: "(555) 010-2004", status: "UNDER_REVIEW" as const, housingSituation: "Renting elsewhere / looking to move", isVeteran: null, desiredMoveInDate: first(1) },
    { firstName: "Victor", lastName: "Nguyen", email: "victor.nguyen@legacy.demo", phone: "(555) 010-2005", status: "WAITLISTED" as const, housingSituation: "Staying with family or friends", isVeteran: false, desiredMoveInDate: first(2) },
    { firstName: "Brianna", lastName: "Scott", email: "brianna.scott@legacy.demo", phone: "(555) 010-2006", status: "DECLINED" as const, housingSituation: "Other", isVeteran: null, desiredMoveInDate: null },
  ];
  for (const a of apps) {
    const { status, ...input } = a;
    const created = await submitApplication({
      ...input,
      preferredContact: "Phone call",
      referralSource: "Demo data",
      message: "This is a fictional demo application.",
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
    await prisma.application.update({
      where: { id: created.id },
      data: { isDemo: true, status, decidedAt: status === "APPROVED" || status === "DECLINED" ? new Date() : null, reviewedById: status === "NEW" ? null : admin.id },
    });
  }

  // Late fees on, then run the engine: posts the overdue resident's late fee + sends reminders.
  await prisma.settings.update({ where: { id: 1 }, data: { lateFeeCents: 2500 } });
  const run = await runRentEngine({ today, actor });

  console.log(`\n✔ Demo data ready (${today}). Engine: ${JSON.stringify(run)}`);
  console.log(`  Owner login:     ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  Resident logins: <first>.<last>@legacy.demo / ${RESIDENT_PASSWORD}  (e.g. angela.price@legacy.demo)`);
  console.log(`  Walkthrough:     approve → convert Jordan Ellis into Legacy House #1 · Room 3 ($750, move-in ${first(1)})`);
  void [marcus, angela, terrence, denise, luis, gloria, kevin];
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
