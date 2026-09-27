import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  canMoveMaintenance,
  compareQueue,
  isOpen,
  maintenanceRef,
  nextMaintenanceStatuses,
  residentCanCancel,
} from "../../src/domain/maintenance.ts";
import { utcToZonedLocal, zonedLocalToUtc } from "../../src/domain/dates.ts";
import { can } from "../../src/domain/permissions.ts";

describe("maintenance rules", () => {
  test("status machine", () => {
    assert.ok(canMoveMaintenance("SUBMITTED", "ACKNOWLEDGED"));
    assert.ok(canMoveMaintenance("ACKNOWLEDGED", "SCHEDULED"));
    assert.ok(canMoveMaintenance("SCHEDULED", "SCHEDULED"), "reschedule");
    assert.ok(canMoveMaintenance("IN_PROGRESS", "COMPLETED"));
    assert.ok(canMoveMaintenance("COMPLETED", "ACKNOWLEDGED"), "reopen");
    assert.ok(!canMoveMaintenance("CANCELED", "SUBMITTED"));
    assert.ok(!canMoveMaintenance("COMPLETED", "IN_PROGRESS"));
    assert.ok(!canMoveMaintenance("IN_PROGRESS", "SUBMITTED"));
    assert.deepEqual(nextMaintenanceStatuses("CANCELED"), []);
  });

  test("open / cancel rules", () => {
    assert.ok(isOpen("SCHEDULED") && !isOpen("COMPLETED") && !isOpen("CANCELED"));
    assert.ok(residentCanCancel("SUBMITTED") && residentCanCancel("ACKNOWLEDGED"));
    assert.ok(!residentCanCancel("SCHEDULED") && !residentCanCancel("IN_PROGRESS"));
  });

  test("queue: open before closed, urgent first, then oldest", () => {
    const t = (d: string) => new Date(d);
    const rows = [
      { id: "closed-urgent", status: "COMPLETED" as const, priority: "URGENT" as const, createdAt: t("2026-09-01") },
      { id: "normal-old", status: "SUBMITTED" as const, priority: "NORMAL" as const, createdAt: t("2026-09-02") },
      { id: "urgent-new", status: "SUBMITTED" as const, priority: "URGENT" as const, createdAt: t("2026-09-20") },
      { id: "low", status: "ACKNOWLEDGED" as const, priority: "LOW" as const, createdAt: t("2026-09-01") },
      { id: "normal-new", status: "SCHEDULED" as const, priority: "NORMAL" as const, createdAt: t("2026-09-10") },
    ];
    assert.deepEqual(
      rows.sort(compareQueue).map((r) => r.id),
      ["urgent-new", "normal-old", "normal-new", "low", "closed-urgent"],
    );
  });

  test("references and permissions", () => {
    assert.equal(maintenanceRef(1042), "MR-1042");
    assert.ok(can("RESIDENT", "self:maintenance"));
    assert.ok(!can("RESIDENT", "maintenance:write"));
    assert.ok(can("ADMIN", "maintenance:write") && !can("ADMIN", "self:maintenance"));
  });
});

describe("business-timezone date-times", () => {
  test("wall clock → UTC across DST", () => {
    assert.equal(zonedLocalToUtc("2026-10-02T09:30", "America/Chicago").toISOString(), "2026-10-02T14:30:00.000Z"); // CDT
    assert.equal(zonedLocalToUtc("2026-12-02T09:30", "America/Chicago").toISOString(), "2026-12-02T15:30:00.000Z"); // CST
    assert.equal(zonedLocalToUtc("2026-11-01T01:30", "America/Chicago").getUTCHours() % 24 >= 6, true); // ambiguous hour resolves
  });
  test("round-trip", () => {
    for (const local of ["2026-03-08T03:15", "2026-07-04T18:00", "2026-11-15T07:45"]) {
      assert.equal(utcToZonedLocal(zonedLocalToUtc(local, "America/Chicago"), "America/Chicago"), local);
    }
    assert.throws(() => zonedLocalToUtc("tomorrow 9am"));
  });
});
