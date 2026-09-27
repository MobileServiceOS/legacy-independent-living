/**
 * Service-level integration tests against a real Postgres with the real
 * migrations. Exercises every money-moving flow end to end.
 *
 *   TEST_DATABASE_ADMIN_URL=postgresql://legacy:legacy@localhost:5432/postgres \
 *     node --import tsx --test tests/integration/*.test.ts
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://legacy:legacy@localhost:5432/postgres";
const DB = `lil_flows_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${DB}$1`);
const MIGRATIONS = join(import.meta.dirname, "../../prisma/migrations");

process.env.DATABASE_URL = DB_URL;
process.env.PAYMENTS_PROVIDER = "mock";
process.env.APP_URL = "http://localhost:3000";
process.env.APP_TODAY = "2026-09-27";
process.env.STORAGE_DIR = join(import.meta.dirname, "../../.test-storage");

// Imported lazily so DATABASE_URL is set before Prisma initializes.
type Mods = {
  prisma: typeof import("../../src/lib/db").prisma;
  residents: typeof import("../../src/server/residents");
  payments: typeof import("../../src/server/payments");
  ledger: typeof import("../../src/server/ledger");
  rent: typeof import("../../src/server/rent-engine");
  apps: typeof import("../../src/server/applications");
  auth: typeof import("../../src/server/auth");
  queries: typeof import("../../src/server/queries");
  props: typeof import("../../src/server/properties");
  maint: typeof import("../../src/server/maintenance");
  providers: typeof import("../../src/lib/payments");
  paypal: typeof import("../../src/lib/payments/paypal");
};
let m: Mods;
let actor: { id: string; email: string; role: "ADMIN" };
let house1: string;
const rooms: Record<string, string> = {};
const TODAY = "2026-09-27";

before(async () => {
  execFileSync("psql", [ADMIN_URL, "-qc", `DROP DATABASE IF EXISTS ${DB}`]);
  execFileSync("psql", [ADMIN_URL, "-qc", `CREATE DATABASE ${DB}`]);
  for (const dir of readdirSync(MIGRATIONS).filter((d) => /^\d+/.test(d)).sort()) {
    execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", join(MIGRATIONS, dir, "migration.sql")]);
  }
  m = {
    prisma: (await import("../../src/lib/db")).prisma,
    residents: await import("../../src/server/residents"),
    payments: await import("../../src/server/payments"),
    ledger: await import("../../src/server/ledger"),
    rent: await import("../../src/server/rent-engine"),
    apps: await import("../../src/server/applications"),
    auth: await import("../../src/server/auth"),
    queries: await import("../../src/server/queries"),
    props: await import("../../src/server/properties"),
    maint: await import("../../src/server/maintenance"),
    providers: await import("../../src/lib/payments"),
    paypal: await import("../../src/lib/payments/paypal"),
  };
  const { hashPassword } = await import("../../src/lib/security/crypto");
  const admin = await m.prisma.user.create({
    data: { email: "owner@test.local", name: "Owner", role: "ADMIN", status: "ACTIVE", passwordHash: await hashPassword("OwnerPass123") },
  });
  actor = { id: admin.id, email: admin.email, role: "ADMIN" };
  const p = await m.props.saveProperty(actor, undefined, { name: "Legacy House #1", addressLine1: "1 Test St", addressLine2: null, city: "Houston", state: "TX", postalCode: "77002", notes: null });
  house1 = p.id;
  for (const n of [1, 2, 3, 4, 5]) {
    const r = await m.props.saveRoom(actor, { propertyId: house1, name: `Room ${n}`, defaultRent: 75000, notes: null });
    rooms[`r${n}`] = r.id;
  }
});

after(async () => {
  await m?.prisma.$disconnect();
  spawnSync("psql", [ADMIN_URL, "-qc", `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
});

async function balanceOf(residentId: string) {
  return (await m.ledger.residentFinancials(m.prisma, residentId, TODAY)).position;
}

describe("spec success scenario: apply → approve → convert → sign in → pay → $0", () => {
  let residentId = "";
  let userId = "";

  test("applicant is approved and converted into House #1 Room 3 at $750, Oct 1 move-in", async () => {
    const app = await m.apps.submitApplication({
      firstName: "Casey",
      lastName: "Morgan",
      email: "casey@test.local",
      phone: "555-010-3000",
      desiredMoveInDate: "2026-10-01",
      isVeteran: true,
      referralSource: null,
      message: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
    await assert.rejects(m.residents.placeResident(actor, placement(app.id)), /Only approved/);
    await m.apps.setApplicationStatus(actor, { applicationId: app.id, status: "APPROVED", reviewNotes: "Great fit" });
    const res = await m.residents.placeResident(actor, placement(app.id));
    residentId = res.residentId;
    assert.match(res.inviteUrl, /^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}$/);

    const resident = await m.prisma.resident.findUniqueOrThrow({ where: { id: residentId }, include: { user: true, assignments: true, rentSchedules: true } });
    userId = resident.userId!;
    assert.equal(resident.user!.role, "RESIDENT");
    assert.equal(resident.user!.status, "INVITED");
    assert.equal(resident.assignments.length, 1);
    assert.equal(resident.rentSchedules[0]!.monthlyRentCents, 75000);
    assert.equal((await m.prisma.room.findUniqueOrThrow({ where: { id: rooms.r3! } })).status, "OCCUPIED");
    assert.equal((await m.prisma.application.findUniqueOrThrow({ where: { id: app.id } })).status, "CONVERTED");

    const pos = await balanceOf(residentId);
    assert.equal(pos.balanceCents, 75000);
    assert.equal(pos.nextDueDate, "2026-10-01");
    assert.equal(pos.status, "DUE_SOON");
  });

  test("resident sets a password from the invite and can sign in", async () => {
    const token = (await m.residents.reissueInvite(actor, residentId)).split("/invite/")[1]!;
    await assert.rejects(m.auth.acceptInvite(token, "short"), /at least/);
    const user = await m.auth.acceptInvite(token, "Resident2026ok");
    assert.equal(user.status, "ACTIVE");
    await assert.rejects(m.auth.acceptInvite(token, "Resident2026ok"), /expired or was already used/);
    const authed = await m.auth.authenticate("CASEY@test.local", "Resident2026ok");
    const { token: session } = await m.auth.createSession(authed, { ip: "127.0.0.1" });
    const su = await m.auth.lookupSession(session);
    assert.equal(su?.residentId, residentId);
    await assert.rejects(m.auth.authenticate("casey@test.local", "wrong-password"), /don't match/);
  });

  test("resident pays $750 online (sandbox) → ledger payment, balance $0, receipt, admin collection", async () => {
    const before = await m.queries.adminDashboard(TODAY);
    const { paymentId, redirectUrl } = await m.payments.startOnlinePayment({ id: userId, email: "casey@test.local" }, { amount: 75000, method: "DEBIT_CARD" });
    assert.equal(redirectUrl, `/pay/sandbox/${paymentId}`);
    assert.equal((await balanceOf(residentId)).balanceCents, 75000, "starting checkout must not move money");

    const status = await m.payments.completeSandboxPayment({ id: userId }, paymentId, "succeed");
    assert.equal(status, "SUCCEEDED");
    const pos = await balanceOf(residentId);
    assert.equal(pos.balanceCents, 0);
    assert.equal(pos.status, "PAID");
    assert.equal(pos.nextDueDate, "2026-11-01");

    const entries = await m.prisma.ledgerEntry.findMany({ where: { residentId }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(entries.map((e) => [e.type, e.amountCents]), [["RENT_CHARGE", 75000], ["PAYMENT", -75000]]);
    const payment = await m.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assert.match(payment.receiptNumber, /^LIL-20260927-/);
    assert.ok(await m.prisma.notification.findFirst({ where: { userId, type: "PAYMENT_SUCCEEDED" } }));

    const afterDash = await m.queries.adminDashboard(TODAY);
    assert.equal(afterDash.collection.collectedCents - before.collection.collectedCents, 0, "Sept collection unchanged (charge is October)");
    const oct = (await m.queries.reports(TODAY, { month: "2026-10" })).collection;
    assert.equal(oct.collectedCents, 75000);
    assert.equal(afterDash.rentDue.find((r) => r.id === residentId)?.position.status, "PAID");

    // replaying the provider event is a no-op (no double credit)
    await m.payments.completeSandboxPayment({ id: userId }, paymentId, "succeed");
    assert.equal((await balanceOf(residentId)).balanceCents, 0);
  });

  test("room stays assigned to the resident", async () => {
    const a = await m.prisma.roomAssignment.findFirstOrThrow({ where: { roomId: rooms.r3!, endDate: null } });
    assert.equal(a.residentId, residentId);
  });

  function placement(applicationId?: string) {
    return {
      applicationId,
      firstName: "Casey",
      lastName: "Morgan",
      email: "casey@test.local",
      phone: "555-010-3000",
      emergencyContactName: null,
      emergencyContactPhone: null,
      emergencyContactRelation: null,
      notes: null,
      roomId: rooms.r3!,
      monthlyRent: 75000,
      moveInDate: "2026-10-01",
      dueDay: 1,
    };
  }
});

describe("payment edge cases", () => {
  let residentId = "";
  let userId = "";
  before(async () => {
    const r = await m.residents.placeResident(actor, {
      firstName: "Pat",
      lastName: "Lee",
      email: "pat@test.local",
      phone: "555-010-3001",
      emergencyContactName: null,
      emergencyContactPhone: null,
      emergencyContactRelation: null,
      notes: null,
      roomId: rooms.r1!,
      monthlyRent: 70000,
      moveInDate: "2026-09-01",
      dueDay: 1,
    });
    residentId = r.residentId;
    userId = (await m.prisma.resident.findUniqueOrThrow({ where: { id: residentId } })).userId!;
  });

  test("move-in Sept 1 backfills Sept + Oct rent; Sept is overdue", async () => {
    const pos = await balanceOf(residentId);
    assert.equal(pos.balanceCents, 140000);
    assert.equal(pos.status, "OVERDUE");
    assert.equal(pos.daysOverdue, 26);
  });

  test("overpayment and below-minimum partials are rejected", async () => {
    await assert.rejects(m.payments.startOnlinePayment({ id: userId, email: "pat@test.local" }, { amount: 140001, method: "CREDIT_CARD" }), /most you can pay/);
    await assert.rejects(m.payments.startOnlinePayment({ id: userId, email: "pat@test.local" }, { amount: 100, method: "CREDIT_CARD" }), /at least/);
  });

  test("declined card: payment FAILED, no ledger change, resident + admin notified", async () => {
    const { paymentId } = await m.payments.startOnlinePayment({ id: userId, email: "pat@test.local" }, { amount: 70000, method: "CREDIT_CARD" });
    assert.equal(await m.payments.completeSandboxPayment({ id: userId }, paymentId, "decline"), "FAILED");
    assert.equal((await balanceOf(residentId)).balanceCents, 140000);
    assert.ok(await m.prisma.notification.findFirst({ where: { userId, type: "PAYMENT_FAILED" } }));
    assert.ok(await m.prisma.notification.findFirst({ where: { userId: actor.id, type: "PAYMENT_FAILED" } }));
    // a failed payment can't later succeed
    await m.payments.completeSandboxPayment({ id: userId }, paymentId, "succeed");
    assert.equal((await m.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status, "FAILED");
  });

  test("ACH: processing → PENDING status (balance unchanged) → clears → PAID", async () => {
    const { paymentId } = await m.payments.startOnlinePayment({ id: userId, email: "pat@test.local" }, { amount: 140000, method: "ACH" });
    assert.equal(await m.payments.completeSandboxPayment({ id: userId }, paymentId, "ach_pending"), "PROCESSING");
    let pos = await balanceOf(residentId);
    assert.equal(pos.balanceCents, 140000);
    assert.equal(pos.status, "PENDING");
    await assert.rejects(m.payments.startOnlinePayment({ id: userId, email: "pat@test.local" }, { amount: 100, method: "ACH" }), /no balance/);
    await m.payments.simulateAchResult(actor, paymentId, true);
    pos = await balanceOf(residentId);
    assert.equal(pos.balanceCents, 0);
    assert.equal(pos.status, "PAID");
  });

  test("refund re-opens the balance and is audited; double refund is refused", async () => {
    const p = await m.prisma.payment.findFirstOrThrow({ where: { residentId, status: "SUCCEEDED" } });
    await m.payments.refundPayment(actor, { paymentId: p.id, reason: "Duplicate" });
    assert.equal((await balanceOf(residentId)).balanceCents, 140000);
    assert.equal((await m.prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status, "REFUNDED");
    assert.ok(await m.prisma.auditLog.findFirst({ where: { action: "payment.refunded", entityId: p.id } }));
    await assert.rejects(m.payments.refundPayment(actor, { paymentId: p.id, reason: "again" }), /can't be refunded/);
  });

  test("offline money order recorded with who entered it", async () => {
    const p = await m.payments.recordOfflinePayment(actor, { residentId, amount: 140000, paidOn: "2026-09-26", method: "MONEY_ORDER", reference: "MO #123", note: null });
    assert.equal(p.recordedById, actor.id);
    assert.equal((await balanceOf(residentId)).balanceCents, 0);
    await assert.rejects(m.payments.recordOfflinePayment(actor, { residentId, amount: 1, paidOn: "2026-12-01", method: "CASH", reference: "x", note: null }), /future/);
  });

  test("another resident's payment can't be completed", async () => {
    const other = await m.prisma.payment.findFirstOrThrow({ where: { residentId: { not: residentId } } });
    await assert.rejects(m.payments.completeSandboxPayment({ id: userId }, other.id, "succeed"), /not found/);
  });
});

describe("rent engine, transfers, rent changes, move-out", () => {
  let residentId = "";
  before(async () => {
    const r = await m.residents.placeResident(actor, {
      firstName: "Jo",
      lastName: "Ray",
      email: "jo@test.local",
      phone: "555-010-3002",
      emergencyContactName: null,
      emergencyContactPhone: null,
      emergencyContactRelation: null,
      notes: null,
      roomId: rooms.r2!,
      monthlyRent: 75000,
      moveInDate: "2026-08-01",
      dueDay: 1,
    });
    residentId = r.residentId;
  });

  test("engine is idempotent", async () => {
    const count = () => m.prisma.ledgerEntry.count({ where: { residentId, type: "RENT_CHARGE" } });
    assert.equal(await count(), 3); // Aug, Sep, Oct
    await m.rent.runRentEngine({ today: TODAY });
    await m.rent.runRentEngine({ today: TODAY });
    assert.equal(await count(), 3);
  });

  test("late fees: one per unpaid rent charge after grace", async () => {
    await m.prisma.settings.update({ where: { id: 1 }, data: { lateFeeCents: 2500, graceDays: 5 } });
    await m.rent.runRentEngine({ today: TODAY });
    await m.rent.runRentEngine({ today: TODAY });
    assert.equal(await m.prisma.ledgerEntry.count({ where: { residentId, type: "LATE_FEE" } }), 2); // Aug + Sep
    await m.prisma.settings.update({ where: { id: 1 }, data: { lateFeeCents: 0 } });
  });

  test("overdue reminder sent once", async () => {
    const r = await m.prisma.resident.findUniqueOrThrow({ where: { id: residentId } });
    await m.prisma.user.update({ where: { id: r.userId! }, data: { status: "ACTIVE" } });
    await m.rent.runRentEngine({ today: TODAY });
    await m.rent.runRentEngine({ today: TODAY });
    assert.equal(await m.prisma.notification.count({ where: { userId: r.userId!, type: "RENT_OVERDUE" } }), 1);
  });

  test("transfer frees the old room and occupies the new one", async () => {
    await m.residents.transferRoom(actor, { residentId, roomId: rooms.r4!, effectiveDate: TODAY, reason: "Accessibility" });
    assert.equal((await m.prisma.room.findUniqueOrThrow({ where: { id: rooms.r2! } })).status, "AVAILABLE");
    assert.equal((await m.prisma.room.findUniqueOrThrow({ where: { id: rooms.r4! } })).status, "OCCUPIED");
    await assert.rejects(m.residents.transferRoom(actor, { residentId, roomId: rooms.r3!, effectiveDate: TODAY, reason: null }), /not available/);
  });

  test("rent change applies to periods not yet posted", async () => {
    await m.residents.changeRent(actor, { residentId, monthlyRent: 80000, dueDay: 1, effectiveDate: "2026-10-15", reason: "Larger room" });
    await m.rent.runRentEngine({ today: "2026-10-28" });
    const nov = await m.prisma.ledgerEntry.findUniqueOrThrow({ where: { idempotencyKey: `rent:${residentId}:2026-11` } });
    assert.equal(nov.amountCents, 80000);
    const oct = await m.prisma.ledgerEntry.findUniqueOrThrow({ where: { idempotencyKey: `rent:${residentId}:2026-10` } });
    assert.equal(oct.amountCents, 75000);
  });

  test("move-out frees the room, reverses rent posted for after move-out, keeps history", async () => {
    const before = await m.prisma.ledgerEntry.count({ where: { residentId } });
    await m.residents.moveOutResident(actor, { residentId, moveOutDate: "2026-10-20", reason: null });
    const r = await m.prisma.resident.findUniqueOrThrow({ where: { id: residentId } });
    assert.equal(r.status, "MOVED_OUT");
    assert.equal((await m.prisma.room.findUniqueOrThrow({ where: { id: rooms.r4! } })).status, "AVAILABLE");
    const reversal = await m.prisma.ledgerEntry.findFirstOrThrow({ where: { residentId, type: "ADJUSTMENT" } });
    assert.equal(reversal.amountCents, -80000); // November rent reversed
    assert.ok((await m.prisma.ledgerEntry.count({ where: { residentId } })) > before, "history is only ever appended");
    await m.rent.runRentEngine({ today: "2026-12-01" });
    assert.equal(await m.prisma.ledgerEntry.count({ where: { residentId, idempotencyKey: { startsWith: `rent:${residentId}:2026-12` } } }), 0);
    await assert.rejects(m.residents.moveOutResident(actor, { residentId, moveOutDate: "2026-10-21", reason: null }), /already moved out/);
  });

  test("manual ledger entries respect sign rules and are audited", async () => {
    await m.residents.addManualLedgerEntry(actor, { residentId, kind: "CREDIT", amount: 1000, effectiveDate: TODAY, description: "Goodwill" });
    const credit = await m.prisma.ledgerEntry.findFirstOrThrow({ where: { residentId, type: "CREDIT" } });
    assert.equal(credit.amountCents, -1000);
    assert.ok(await m.prisma.auditLog.findFirst({ where: { action: "ledger.credit_issued", entityId: residentId } }));
  });

  test("room status can't be changed while occupied", async () => {
    await assert.rejects(m.props.setRoomStatus(actor, rooms.r3!, "MAINTENANCE"), /Move the resident out/);
    await m.props.setRoomStatus(actor, rooms.r5!, "MAINTENANCE");
    assert.equal((await m.prisma.room.findUniqueOrThrow({ where: { id: rooms.r5! } })).status, "MAINTENANCE");
  });
});

describe("maintenance requests: resident ↔ office", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  let resident: { id: string; name: string; email: string; residentId: string };
  let other: { id: string; name: string; email: string; residentId: string };
  let admin: { id: string; email: string; role: "ADMIN"; name: string };
  let requestId = "";

  before(async () => {
    admin = { ...actor, name: "Owner" };
    const r = await m.prisma.resident.findFirstOrThrow({ where: { email: "casey@test.local" }, include: { user: true } });
    resident = { id: r.userId!, name: r.user!.name, email: r.email, residentId: r.id };
    const o = await m.prisma.resident.findFirstOrThrow({ where: { email: "pat@test.local" }, include: { user: true } });
    other = { id: o.userId!, name: o.user!.name, email: o.email, residentId: o.id };
  });

  test("resident submits with a photo; room captured; admins notified; audited", async () => {
    const photo = new File([PNG], "leak.png", { type: "image/png" });
    const req = await m.maint.submitMaintenanceRequest(
      resident,
      { category: "PLUMBING", priority: "URGENT", title: "Sink leaking", description: "Water under the sink", location: "My room", permissionToEnter: true, entryNotes: "Knock first" },
      [photo],
    );
    requestId = req.id;
    assert.equal(req.status, "SUBMITTED");
    assert.equal(req.roomId, rooms.r3);
    assert.equal(req.propertyId, house1);
    assert.equal(await m.prisma.maintenancePhoto.count({ where: { requestId } }), 1);
    const n = await m.prisma.notification.findFirstOrThrow({ where: { userId: actor.id, type: "MAINTENANCE_SUBMITTED" } });
    assert.match(n.title, /URGENT repair MR-\d+/);
    assert.ok(await m.prisma.auditLog.findFirst({ where: { action: "maintenance.submitted", entityId: requestId } }));
  });

  test("non-image uploads and too many photos are rejected, nothing is saved", async () => {
    const before = await m.prisma.maintenanceRequest.count();
    const exe = new File([new Uint8Array([0x4d, 0x5a, 0, 0])], "virus.png", { type: "image/png" });
    await assert.rejects(
      m.maint.submitMaintenanceRequest(resident, { category: "GENERAL", priority: "LOW", title: "x", description: "y", location: null, permissionToEnter: false, entryNotes: null }, [exe]),
      /JPG, PNG/,
    );
    const four = Array.from({ length: 4 }, (_, i) => new File([PNG], `p${i}.png`));
    await assert.rejects(
      m.maint.submitMaintenanceRequest(resident, { category: "GENERAL", priority: "LOW", title: "x", description: "y", location: null, permissionToEnter: false, entryNotes: null }, four),
      /up to 3/,
    );
    assert.equal(await m.prisma.maintenanceRequest.count(), before);
  });

  test("another resident can't see, comment on, or cancel it", async () => {
    assert.equal(await m.maint.getResidentRequest(other.residentId, requestId), null);
    await assert.rejects(m.maint.residentComment(other, requestId, "hi"), /not found/);
    await assert.rejects(m.maint.residentCancel(other, requestId, null), /not found/);
    const photo = await m.prisma.maintenancePhoto.findFirstOrThrow({ where: { requestId } });
    assert.equal(await m.maint.getPhotoForViewer(photo.id, { role: "RESIDENT", residentId: other.residentId }), null);
    assert.ok(await m.maint.getPhotoForViewer(photo.id, { role: "RESIDENT", residentId: resident.residentId }));
    assert.ok(await m.maint.getPhotoForViewer(photo.id, { role: "ADMIN", residentId: null }));
  });

  test("staff schedules a visit (business timezone) → resident notified", async () => {
    await m.maint.staffUpdate(admin, { requestId, status: "SCHEDULED", priority: "URGENT", scheduledFor: "2026-09-28T09:30", assignedTo: "Mike (handyman)", body: "Mike will come by tomorrow morning.", internal: false });
    const req = await m.prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(req.status, "SCHEDULED");
    assert.equal(req.scheduledFor!.toISOString(), "2026-09-28T14:30:00.000Z");
    const n = await m.prisma.notification.findFirstOrThrow({ where: { userId: resident.id, type: "MAINTENANCE_UPDATE" }, orderBy: { createdAt: "desc" } });
    assert.match(n.body, /Visit scheduled for Mon, Sep 28, 9:30/);
  });

  test("staff-only notes stay hidden from the resident and don't notify them", async () => {
    const before = await m.prisma.notification.count({ where: { userId: resident.id } });
    await m.maint.staffUpdate(admin, { requestId, status: "SCHEDULED", priority: "URGENT", scheduledFor: "2026-09-28T09:30", assignedTo: "Mike (handyman)", body: "Parts cost $40, bill to house", internal: true });
    assert.equal(await m.prisma.notification.count({ where: { userId: resident.id } }), before);
    const view = await m.maint.getResidentRequest(resident.residentId, requestId);
    assert.ok(view!.updates.every((u) => !u.internal && !(u.body ?? "").includes("$40")));
    const staff = await m.maint.getMaintenanceForStaff(requestId);
    assert.ok(staff!.updates.some((u) => u.internal));
  });

  test("resident can't cancel once scheduled; can message; office notified", async () => {
    await assert.rejects(m.maint.residentCancel(resident, requestId, null), /already underway/);
    await m.maint.residentComment(resident, requestId, "I'll be home after 9");
    assert.ok(await m.prisma.notification.findFirst({ where: { userId: actor.id, type: "MAINTENANCE_UPDATE", body: { contains: "home after 9" } } }));
  });

  test("illegal jumps and empty updates are refused", async () => {
    await assert.rejects(
      m.maint.staffUpdate(admin, { requestId, status: "SUBMITTED", priority: "URGENT", scheduledFor: "2026-09-28T09:30", assignedTo: "Mike (handyman)", body: null, internal: false }),
      /Can't move/,
    );
    await assert.rejects(
      m.maint.staffUpdate(admin, { requestId, status: "SCHEDULED", priority: "URGENT", scheduledFor: "2026-09-28T09:30", assignedTo: "Mike (handyman)", body: null, internal: false }),
      /Nothing changed/,
    );
  });

  test("complete → resident reopens → office sees it again", async () => {
    await m.maint.staffUpdate(admin, { requestId, status: "COMPLETED", priority: "URGENT", scheduledFor: "2026-09-28T09:30", assignedTo: "Mike (handyman)", body: "Replaced the trap.", internal: false });
    let req = await m.prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: requestId } });
    assert.ok(req.completedAt);
    await m.maint.residentReopen(resident, requestId, "Still dripping a bit");
    req = await m.prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(req.status, "ACKNOWLEDGED");
    assert.equal(req.completedAt, null);
    const q = await m.maint.listMaintenance({ status: "OPEN" });
    assert.equal(q[0]!.id, requestId, "urgent open request is first in the queue");
  });

  test("resident cancels a fresh request", async () => {
    const r2 = await m.maint.submitMaintenanceRequest(resident, { category: "PESTS", priority: "LOW", title: "Ants", description: "In kitchen", location: null, permissionToEnter: false, entryNotes: null });
    await m.maint.residentCancel(resident, r2.id, "Gone now");
    const got = await m.prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: r2.id } });
    assert.equal(got.status, "CANCELED");
    assert.ok(got.canceledAt);
    await assert.rejects(m.maint.residentComment(resident, r2.id, "back"), /canceled/);
    const counts = await m.maint.maintenanceCounts();
    assert.equal(counts.open, 1);
    assert.equal(counts.urgent, 1);
  });

  test("moved-out residents can't submit new requests", async () => {
    const jo = await m.prisma.resident.findFirstOrThrow({ where: { email: "jo@test.local" }, include: { user: true } });
    await assert.rejects(
      m.maint.submitMaintenanceRequest({ id: jo.userId!, name: "Jo", email: jo.email, residentId: jo.id }, { category: "GENERAL", priority: "LOW", title: "x", description: "y", location: null, permissionToEnter: false, entryNotes: null }),
      /current residents/,
    );
  });
});

describe("PayPal: checkout → return capture → ledger → webhook replay → refund", () => {
  let user: { id: string; email: string };
  let residentId = "";
  const paypalCalls: string[] = [];
  let captureStatus = "COMPLETED";

  before(async () => {
    const r = await m.prisma.resident.findFirstOrThrow({ where: { email: "pat@test.local" } });
    residentId = r.id;
    user = { id: r.userId!, email: r.email };
    // Earlier suites run the rent engine into the future for everyone; settle Pat to $0 first.
    const open = (await balanceOf(residentId)).balanceCents;
    if (open > 0) await m.payments.recordOfflinePayment(actor, { residentId, amount: open, paidOn: TODAY, method: "CASH", reference: "test reset", note: null });
    await m.residents.addManualLedgerEntry(actor, { residentId, kind: "OTHER_CHARGE", amount: 5000, effectiveDate: TODAY, description: "Key replacement" });
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      paypalCalls.push(`${init.method} ${path}`);
      const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
      const ok = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });
      if (path === "/v1/oauth2/token") return ok({ access_token: "t", expires_in: 3600 });
      if (path === "/v2/checkout/orders") return ok({ id: `ORDER-${body.purchase_units[0].custom_id}`, links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=x" }] });
      const cap = /^\/v2\/checkout\/orders\/(ORDER-[^/]+)\/capture$/.exec(path);
      if (cap) return ok({ id: cap[1], purchase_units: [{ payments: { captures: [{ id: `CAP-${cap[1]}`, status: captureStatus }] } }] }, 201);
      const refund = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(path);
      if (refund) return ok({ id: `REF-${refund[1]}`, status: "COMPLETED" }, 201);
      if (path === "/v1/notifications/verify-webhook-signature") return ok({ verification_status: "SUCCESS" });
      return ok({ message: "not found" }, 404);
    }) as unknown as typeof fetch;
    m.providers.setPaymentProviderForTests(new m.paypal.PayPalPaymentProvider({ clientId: "c", clientSecret: "s", webhookId: "WH", env: "sandbox" }, fetchImpl));
  });

  after(() => m.providers.setPaymentProviderForTests(null));

  test("only PayPal is offered; other methods refused", async () => {
    await assert.rejects(m.payments.startOnlinePayment(user, { amount: 5000, method: "DEBIT_CARD" }), /isn't available/);
  });

  test("pay $50 via PayPal: redirect to PayPal, return captures, balance $0, capture id stored", async () => {
    const { paymentId, redirectUrl } = await m.payments.startOnlinePayment(user, { amount: 5000, method: "PAYPAL" });
    assert.match(redirectUrl, /^https:\/\/www\.sandbox\.paypal\.com\//);
    let p = await m.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assert.equal(p.provider, "PAYPAL");
    assert.equal(p.providerRef, `ORDER-${paymentId}`);
    assert.equal((await balanceOf(residentId)).balanceCents, 5000, "approval alone moves no money");

    assert.equal(await m.payments.completeRedirectPayment(user, paymentId), "SUCCEEDED");
    p = await m.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assert.equal(p.providerRef, `CAP-ORDER-${paymentId}`);
    assert.equal(p.cardBrand, "PayPal");
    assert.equal((await balanceOf(residentId)).balanceCents, 0);

    // refreshing the return URL does nothing more
    assert.equal(await m.payments.completeRedirectPayment(user, paymentId), "SUCCEEDED");
    assert.equal(paypalCalls.filter((c) => c.endsWith("/capture")).length, 1);

    // late webhook for the same capture: no double credit
    const provider = m.providers.getPaymentProvider();
    const hdrs = new Headers({
      "paypal-auth-algo": "a", "paypal-cert-url": "https://api.sandbox.paypal.com/c", "paypal-transmission-id": "t",
      "paypal-transmission-sig": "s", "paypal-transmission-time": "now",
    });
    const ev = await provider.parseWebhook(JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: p.providerRef, custom_id: paymentId } }), hdrs);
    await m.payments.applyProviderEvent("PAYPAL", ev);
    assert.equal((await balanceOf(residentId)).balanceCents, 0);
    assert.equal(await m.prisma.ledgerEntry.count({ where: { paymentId, type: "PAYMENT" } }), 1);

    // refund goes to PayPal against the capture, ledger re-opens the balance
    await m.payments.refundPayment(actor, { paymentId, reason: "Charged in error" });
    assert.ok(paypalCalls.includes(`POST /v2/payments/captures/CAP-ORDER-${paymentId}/refund`));
    assert.equal((await balanceOf(residentId)).balanceCents, 5000);
  });

  test("eCheck: capture PENDING → payment pending → webhook COMPLETED settles it", async () => {
    captureStatus = "PENDING";
    const { paymentId } = await m.payments.startOnlinePayment(user, { amount: 5000, method: "PAYPAL" });
    assert.equal(await m.payments.completeRedirectPayment(user, paymentId), "PROCESSING");
    assert.equal((await balanceOf(residentId)).status, "PENDING");
    const p = await m.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await m.payments.applyProviderEvent("PAYPAL", { kind: "succeeded", paymentId: null, providerRef: p.providerRef, eventId: "WH-ECHECK-DONE" });
    assert.equal((await balanceOf(residentId)).balanceCents, 0);
    captureStatus = "COMPLETED";
  });

  test("resident cancels on PayPal → payment closed, nothing charged; others can't touch it", async () => {
    await m.residents.addManualLedgerEntry(actor, { residentId, kind: "OTHER_CHARGE", amount: 2500, effectiveDate: TODAY, description: "Fee" });
    const { paymentId } = await m.payments.startOnlinePayment(user, { amount: 2500, method: "PAYPAL" });
    const casey = await m.prisma.resident.findFirstOrThrow({ where: { email: "casey@test.local" } });
    await assert.rejects(m.payments.completeRedirectPayment({ id: casey.userId! }, paymentId), /not found/);
    await m.payments.cancelRedirectPayment(user, paymentId);
    assert.equal((await m.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status, "CANCELED");
    assert.equal((await balanceOf(residentId)).balanceCents, 2500);
  });
});
