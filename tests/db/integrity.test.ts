/**
 * Database-level integrity tests against a REAL Postgres, using psql only.
 * Creates a throwaway database, applies every migration, then proves the
 * financial guarantees hold even if application code misbehaves.
 *
 *   TEST_DATABASE_ADMIN_URL=postgresql://legacy:legacy@localhost:5432/postgres node --test tests/db/
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://legacy:legacy@localhost:5432/postgres";
const DB = `lil_integrity_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${DB}$1`);
const MIGRATIONS = join(import.meta.dirname, "../../prisma/migrations");

function psql(url: string, sql: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql], { encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}
const run = (sql: string) => {
  const r = psql(DB_URL, sql);
  if (!r.ok) throw new Error(r.err);
  return r.out;
};
const rejects = (sql: string, pattern: RegExp) => {
  const r = psql(DB_URL, sql);
  assert.equal(r.ok, false, `expected failure: ${sql}`);
  assert.match(r.err, pattern);
};

before(() => {
  execFileSync("psql", [ADMIN_URL, "-qc", `DROP DATABASE IF EXISTS ${DB}`]);
  execFileSync("psql", [ADMIN_URL, "-qc", `CREATE DATABASE ${DB}`]);
  for (const dir of readdirSync(MIGRATIONS).filter((d) => /^\d+/.test(d)).sort()) {
    execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", join(MIGRATIONS, dir, "migration.sql")]);
  }
  run(`
    INSERT INTO users (id,email,name,role,status,updated_at) VALUES ('u_admin','owner@example.test','Owner','ADMIN','ACTIVE',now());
    INSERT INTO properties (id,name,address_line1,city,state,postal_code,updated_at) VALUES ('p1','House 1','1 Main','Houston','TX','77002',now());
    INSERT INTO rooms (id,property_id,name,default_rent_cents,updated_at) VALUES ('rm1','p1','Room 1',75000,now()),('rm2','p1','Room 2',75000,now());
    INSERT INTO residents (id,first_name,last_name,email,phone,move_in_date,updated_at) VALUES
      ('r1','Ann','A','a@example.test','1','2026-10-01',now()), ('r2','Bo','B','b@example.test','2','2026-10-01',now());
    INSERT INTO payments (id,resident_id,amount_cents,method,status,provider,receipt_number,updated_at)
      VALUES ('pay1','r1',75000,'CREDIT_CARD','SUCCEEDED','MOCK','LIL-1',now());
    INSERT INTO ledger_entries (id,resident_id,type,amount_cents,description,effective_date,idempotency_key)
      VALUES ('le1','r1','RENT_CHARGE',75000,'Rent','2026-10-01','rent:r1:2026-10');
    INSERT INTO ledger_entries (id,resident_id,type,amount_cents,description,effective_date,payment_id)
      VALUES ('le2','r1','PAYMENT',-75000,'Payment','2026-10-01','pay1');
  `);
});

after(() => {
  spawnSync("psql", [ADMIN_URL, "-qc", `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
});

describe("ledger is append-only and sign-checked", () => {
  test("balance is derived from entries", () => {
    assert.equal(run(`SELECT sum(amount_cents) FROM ledger_entries WHERE resident_id='r1'`), "0");
  });
  test("UPDATE is blocked", () => rejects(`UPDATE ledger_entries SET amount_cents=1 WHERE id='le1'`, /append-only/));
  test("DELETE is blocked", () => rejects(`DELETE FROM ledger_entries WHERE id='le1'`, /append-only/));
  test("negative rent charge rejected", () =>
    rejects(`INSERT INTO ledger_entries (id,resident_id,type,amount_cents,description,effective_date) VALUES ('x','r1','RENT_CHARGE',-1,'x','2026-10-01')`, /amount_sign/));
  test("positive payment rejected", () =>
    rejects(`INSERT INTO ledger_entries (id,resident_id,type,amount_cents,description,effective_date,payment_id) VALUES ('x','r1','PAYMENT',5,'x','2026-10-01','pay1')`, /amount_sign/));
  test("zero adjustment rejected", () =>
    rejects(`INSERT INTO ledger_entries (id,resident_id,type,amount_cents,description,effective_date) VALUES ('x','r1','ADJUSTMENT',0,'x','2026-10-01')`, /amount_sign/));
  test("payment entry must reference a payment", () =>
    rejects(`INSERT INTO ledger_entries (id,resident_id,type,amount_cents,description,effective_date) VALUES ('x','r1','PAYMENT',-5,'x','2026-10-01')`, /payment_link/));
  test("idempotency key prevents double rent charge", () =>
    rejects(`INSERT INTO ledger_entries (id,resident_id,type,amount_cents,description,effective_date,idempotency_key) VALUES ('x','r1','RENT_CHARGE',75000,'Rent','2026-10-01','rent:r1:2026-10')`, /idempotency_key/));
  test("a payment can only settle into the ledger once", () =>
    rejects(`INSERT INTO ledger_entries (id,resident_id,type,amount_cents,description,effective_date,payment_id) VALUES ('x','r1','PAYMENT',-1,'dup','2026-10-01','pay1')`, /one_per_payment_type/));
});

describe("payments", () => {
  test("amount is immutable", () => rejects(`UPDATE payments SET amount_cents=1 WHERE id='pay1'`, /immutable/));
  test("succeeded cannot become failed", () => rejects(`UPDATE payments SET status='FAILED' WHERE id='pay1'`, /only be refunded/));
  test("cannot be deleted", () => rejects(`DELETE FROM payments WHERE id='pay1'`, /cannot be deleted/));
  test("failed payment is terminal", () => {
    run(`INSERT INTO payments (id,resident_id,amount_cents,method,status,provider,receipt_number,updated_at) VALUES ('pay2','r1',100,'ACH','FAILED','MOCK','LIL-2',now())`);
    rejects(`UPDATE payments SET status='SUCCEEDED' WHERE id='pay2'`, /terminal/);
  });
  test("zero/negative amounts rejected", () =>
    rejects(`INSERT INTO payments (id,resident_id,amount_cents,method,provider,receipt_number,updated_at) VALUES ('p0','r1',0,'ACH','MOCK','LIL-0',now())`, /amount_positive/));
  test("offline payment must record who entered it", () =>
    rejects(`INSERT INTO payments (id,resident_id,amount_cents,method,status,provider,receipt_number,paid_on,updated_at) VALUES ('p3','r1',100,'CASH','SUCCEEDED','OFFLINE','LIL-3','2026-10-01',now())`, /offline_recorded_by/));
  test("refund transition allowed", () => {
    run(`UPDATE payments SET status='REFUNDED', refunded_at=now() WHERE id='pay1'`);
    assert.equal(run(`SELECT status FROM payments WHERE id='pay1'`), "REFUNDED");
  });
  test("receipt numbers are unique", () =>
    rejects(`INSERT INTO payments (id,resident_id,amount_cents,method,provider,receipt_number,updated_at) VALUES ('p4','r1',1,'ACH','MOCK','LIL-2',now())`, /receipt_number/));
  test("no raw card numbers: last4 must be exactly 4 digits", () =>
    rejects(`INSERT INTO payment_methods (id,resident_id,provider,provider_method_ref,type,last4) VALUES ('pm1','r1','STRIPE','pm_x','CREDIT_CARD','4242424242424242')`, /last4_format/));
});

describe("occupancy + schedules", () => {
  test("one active resident per room", () => {
    run(`INSERT INTO room_assignments (id,resident_id,room_id,start_date) VALUES ('a1','r1','rm1','2026-10-01')`);
    rejects(`INSERT INTO room_assignments (id,resident_id,room_id,start_date) VALUES ('a2','r2','rm1','2026-10-01')`, /one_active_per_room/);
  });
  test("one active room per resident", () =>
    rejects(`INSERT INTO room_assignments (id,resident_id,room_id,start_date) VALUES ('a3','r1','rm2','2026-10-01')`, /one_active_per_resident/));
  test("transfer: ending the old assignment frees the room", () => {
    run(`UPDATE room_assignments SET end_date='2026-10-15' WHERE id='a1'`);
    run(`INSERT INTO room_assignments (id,resident_id,room_id,start_date) VALUES ('a4','r1','rm2','2026-10-15')`);
    run(`INSERT INTO room_assignments (id,resident_id,room_id,start_date) VALUES ('a5','r2','rm1','2026-10-16')`);
    assert.equal(run(`SELECT count(*) FROM room_assignments WHERE end_date IS NULL`), "2");
  });
  test("assignment history cannot be deleted", () => rejects(`DELETE FROM room_assignments WHERE id='a1'`, /cannot be deleted/));
  test("one active rent schedule per resident; due day 1–28", () => {
    run(`INSERT INTO rent_schedules (id,resident_id,monthly_rent_cents,due_day,start_date) VALUES ('s1','r1',75000,1,'2026-10-01')`);
    rejects(`INSERT INTO rent_schedules (id,resident_id,monthly_rent_cents,due_day,start_date) VALUES ('s2','r1',80000,1,'2026-11-01')`, /one_active_per_resident/);
    rejects(`INSERT INTO rent_schedules (id,resident_id,monthly_rent_cents,due_day,start_date) VALUES ('s3','r2',80000,29,'2026-11-01')`, /due_day_range/);
    rejects(`INSERT INTO rent_schedules (id,resident_id,monthly_rent_cents,due_day,start_date) VALUES ('s4','r2',0,1,'2026-11-01')`, /amount_positive/);
  });
  test("room occupied by a resident cannot be deleted; property with rooms cannot be deleted", () => {
    rejects(`DELETE FROM rooms WHERE id='rm1'`, /foreign key/);
    rejects(`DELETE FROM properties WHERE id='p1'`, /foreign key/);
  });
});

describe("residents + audit", () => {
  test("residents are never hard-deleted", () => rejects(`DELETE FROM residents WHERE id='r2'`, /cannot be deleted/));
  test("move-out date cannot precede move-in", () => rejects(`UPDATE residents SET move_out_date='2026-09-01' WHERE id='r2'`, /move_dates/));
  test("audit log is append-only", () => {
    run(`INSERT INTO audit_logs (id,action,entity_type) VALUES ('al1','resident.created','resident')`);
    rejects(`UPDATE audit_logs SET action='x' WHERE id='al1'`, /append-only/);
    rejects(`DELETE FROM audit_logs WHERE id='al1'`, /append-only/);
  });
  test("settings is a singleton with sane ranges", () => {
    rejects(`INSERT INTO settings (id,updated_at) VALUES (2,now())`, /singleton/);
    rejects(`UPDATE settings SET grace_days=-1`, /settings_ranges/);
    assert.equal(run(`SELECT timezone FROM settings`), "America/Chicago");
  });
});

describe("maintenance requests", () => {
  test("setup", () => {
    run(`INSERT INTO maintenance_requests (id,resident_id,category,title,description,updated_at) VALUES ('m1','r1','PLUMBING','Leak','Sink drips',now())`);
    assert.equal(run(`SELECT status || ':' || priority FROM maintenance_requests WHERE id='m1'`), "SUBMITTED:NORMAL");
    assert.ok(Number(run(`SELECT number FROM maintenance_requests WHERE id='m1'`)) > 0);
  });
  test("blank title/description rejected", () =>
    rejects(`INSERT INTO maintenance_requests (id,resident_id,category,title,description,updated_at) VALUES ('m2','r1','GENERAL','  ','x',now())`, /text_present/));
  test("completed_at must match COMPLETED status", () => {
    rejects(`UPDATE maintenance_requests SET status='COMPLETED' WHERE id='m1'`, /completed_at/);
    run(`UPDATE maintenance_requests SET status='COMPLETED', completed_at=now() WHERE id='m1'`);
    rejects(`UPDATE maintenance_requests SET status='ACKNOWLEDGED' WHERE id='m1'`, /completed_at/);
  });
  test("SCHEDULED requires a visit time", () =>
    rejects(`UPDATE maintenance_requests SET status='SCHEDULED', completed_at=NULL WHERE id='m1'`, /scheduled_has_date/));
  test("timeline is append-only; staff-only notes must be written by staff", () => {
    run(`INSERT INTO maintenance_updates (id,request_id,author_name,author_role,body) VALUES ('mu1','m1','Ann','RESIDENT','hello')`);
    rejects(`UPDATE maintenance_updates SET body='edited' WHERE id='mu1'`, /append-only/);
    rejects(`DELETE FROM maintenance_updates WHERE id='mu1'`, /append-only/);
    rejects(`INSERT INTO maintenance_updates (id,request_id,author_name,author_role,body,internal) VALUES ('mu2','m1','Ann','RESIDENT','x',true)`, /internal_staff_only/);
    rejects(`INSERT INTO maintenance_updates (id,request_id,author_name,author_role) VALUES ('mu3','m1','Ann','RESIDENT')`, /has_content/);
  });
  test("requests are never hard-deleted", () => rejects(`DELETE FROM maintenance_requests WHERE id='m1'`, /cannot be deleted/));
});

describe("schema drift checker", () => {
  test("passes on the migrated database", () => {
    const r = spawnSync("node", [join(import.meta.dirname, "../../scripts/check-schema-drift.mjs")], {
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
  });
  test("detects an out-of-band column", () => {
    run(`ALTER TABLE rooms ADD COLUMN sneaky TEXT`);
    const r = spawnSync("node", [join(import.meta.dirname, "../../scripts/check-schema-drift.mjs")], {
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /rooms\.sneaky/);
    run(`ALTER TABLE rooms DROP COLUMN sneaky`);
  });
  test("migration file is self-contained (no Prisma-only syntax)", () => {
    const sql = readFileSync(join(MIGRATIONS, "0001_init/migration.sql"), "utf8");
    assert.ok(!sql.includes("@"));
  });
});
