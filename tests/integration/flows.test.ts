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
