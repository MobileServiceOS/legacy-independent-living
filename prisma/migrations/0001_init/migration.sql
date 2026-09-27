-- Legacy Independent Living — initial schema
-- Part 1 mirrors prisma/schema.prisma. Part 2 adds integrity rules Prisma
-- cannot express (CHECKs, partial unique indexes, append-only triggers).

-- ============================================================ Enums
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RESIDENT');
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');
CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE');
CREATE TYPE "ResidentStatus" AS ENUM ('ACTIVE', 'MOVED_OUT');
CREATE TYPE "ApplicationStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'APPROVED', 'DECLINED', 'WAITLISTED', 'CONVERTED');
CREATE TYPE "LedgerEntryType" AS ENUM ('RENT_CHARGE', 'PAYMENT', 'LATE_FEE', 'OTHER_CHARGE', 'CREDIT', 'ADJUSTMENT', 'REFUND');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'CANCELED');
CREATE TYPE "PaymentMethodType" AS ENUM ('ACH', 'DEBIT_CARD', 'CREDIT_CARD', 'CASH', 'MONEY_ORDER', 'CHECK', 'EXTERNAL');
CREATE TYPE "PaymentProviderName" AS ENUM ('MOCK', 'STRIPE', 'OFFLINE');
CREATE TYPE "DocumentKind" AS ENUM ('HOUSING_AGREEMENT', 'ID_REFERENCE', 'OTHER');
CREATE TYPE "NotificationType" AS ENUM ('RENT_DUE_SOON', 'RENT_DUE_TODAY', 'RENT_OVERDUE', 'PAYMENT_SUCCEEDED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'APPLICATION_RECEIVED', 'APPLICATION_STATUS', 'ANNOUNCEMENT', 'ACCOUNT');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- ============================================================ Tables
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "password_hash" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invite_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "notes" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_rent_cents" INTEGER NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "residents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "application_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "status" "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "move_in_date" DATE NOT NULL,
    "move_out_date" DATE,
    "notes" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "residents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_assignments" (
    "id" TEXT NOT NULL,
    "resident_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "room_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rent_schedules" (
    "id" TEXT NOT NULL,
    "resident_id" TEXT NOT NULL,
    "monthly_rent_cents" INTEGER NOT NULL,
    "due_day" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rent_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "resident_id" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "due_date" DATE,
    "payment_id" TEXT,
    "rent_schedule_id" TEXT,
    "related_entry_id" TEXT,
    "idempotency_key" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "resident_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "method" "PaymentMethodType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProviderName" NOT NULL,
    "provider_ref" TEXT,
    "receipt_number" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "paid_on" DATE,
    "processed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "refunded_at" TIMESTAMP(3),
    "refund_ref" TEXT,
    "card_brand" TEXT,
    "last4" TEXT,
    "initiated_by_id" TEXT,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT,
    "provider" "PaymentProviderName" NOT NULL,
    "event_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "resident_id" TEXT NOT NULL,
    "provider" "PaymentProviderName" NOT NULL,
    "provider_method_ref" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "autopay_enabled" BOOLEAN NOT NULL DEFAULT false,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "preferred_contact" TEXT,
    "desired_move_in_date" DATE,
    "housing_situation" TEXT,
    "is_veteran" BOOLEAN,
    "referral_source" TEXT,
    "message" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "review_notes" TEXT,
    "reviewed_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "resident_id" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "storage_key" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "reference_note" TEXT,
    "visible_to_resident" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempted_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "property_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "business_name" TEXT NOT NULL DEFAULT 'Legacy Independent Living',
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "charge_lead_days" INTEGER NOT NULL DEFAULT 7,
    "grace_days" INTEGER NOT NULL DEFAULT 5,
    "late_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "allow_partial_payments" BOOLEAN NOT NULL DEFAULT true,
    "min_partial_payment_cents" INTEGER NOT NULL DEFAULT 2500,
    "online_payments_enabled" BOOLEAN NOT NULL DEFAULT true,
    "support_phone" TEXT,
    "support_email" TEXT,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- ============================================================ Indexes
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE UNIQUE INDEX "invite_tokens_token_hash_key" ON "invite_tokens"("token_hash");
CREATE INDEX "invite_tokens_user_id_idx" ON "invite_tokens"("user_id");
CREATE UNIQUE INDEX "properties_name_key" ON "properties"("name");
CREATE UNIQUE INDEX "rooms_property_id_name_key" ON "rooms"("property_id", "name");
CREATE UNIQUE INDEX "residents_user_id_key" ON "residents"("user_id");
CREATE UNIQUE INDEX "residents_application_id_key" ON "residents"("application_id");
CREATE INDEX "residents_status_idx" ON "residents"("status");
CREATE INDEX "residents_last_name_first_name_idx" ON "residents"("last_name", "first_name");
CREATE INDEX "room_assignments_room_id_idx" ON "room_assignments"("room_id");
CREATE INDEX "room_assignments_resident_id_idx" ON "room_assignments"("resident_id");
CREATE INDEX "rent_schedules_resident_id_idx" ON "rent_schedules"("resident_id");
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");
CREATE INDEX "ledger_entries_resident_id_effective_date_idx" ON "ledger_entries"("resident_id", "effective_date");
CREATE INDEX "ledger_entries_payment_id_idx" ON "ledger_entries"("payment_id");
CREATE UNIQUE INDEX "payments_provider_ref_key" ON "payments"("provider_ref");
CREATE UNIQUE INDEX "payments_receipt_number_key" ON "payments"("receipt_number");
CREATE INDEX "payments_resident_id_created_at_idx" ON "payments"("resident_id", "created_at");
CREATE INDEX "payments_status_idx" ON "payments"("status");
CREATE INDEX "payments_paid_on_idx" ON "payments"("paid_on");
CREATE UNIQUE INDEX "payment_events_event_id_key" ON "payment_events"("event_id");
CREATE INDEX "payment_events_payment_id_idx" ON "payment_events"("payment_id");
CREATE UNIQUE INDEX "payment_methods_provider_provider_method_ref_key" ON "payment_methods"("provider", "provider_method_ref");
CREATE INDEX "payment_methods_resident_id_idx" ON "payment_methods"("resident_id");
CREATE INDEX "applications_status_created_at_idx" ON "applications"("status", "created_at");
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");
CREATE INDEX "documents_resident_id_idx" ON "documents"("resident_id");
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key" ON "notification_deliveries"("notification_id", "channel");
CREATE INDEX "notification_deliveries_status_channel_idx" ON "notification_deliveries"("status", "channel");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- ============================================================ Foreign keys
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "residents" ADD CONSTRAINT "residents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "residents" ADD CONSTRAINT "residents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rent_schedules" ADD CONSTRAINT "rent_schedules_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_rent_schedule_id_fkey" FOREIGN KEY ("rent_schedule_id") REFERENCES "rent_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_related_entry_id_fkey" FOREIGN KEY ("related_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================ Part 2: integrity rules

-- Money + domain checks
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_default_rent_nonneg" CHECK ("default_rent_cents" >= 0);
ALTER TABLE "rent_schedules" ADD CONSTRAINT "rent_schedules_amount_positive" CHECK ("monthly_rent_cents" > 0);
ALTER TABLE "rent_schedules" ADD CONSTRAINT "rent_schedules_due_day_range" CHECK ("due_day" BETWEEN 1 AND 28);
ALTER TABLE "rent_schedules" ADD CONSTRAINT "rent_schedules_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date" - 1);
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "residents" ADD CONSTRAINT "residents_move_dates" CHECK ("move_out_date" IS NULL OR "move_out_date" >= "move_in_date");
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_offline_recorded_by" CHECK ("provider" <> 'OFFLINE' OR ("recorded_by_id" IS NOT NULL AND "paid_on" IS NOT NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payments_last4_format" CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$');
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_last4_format" CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$');
ALTER TABLE "settings" ADD CONSTRAINT "settings_singleton" CHECK ("id" = 1);
ALTER TABLE "settings" ADD CONSTRAINT "settings_ranges" CHECK (
  "charge_lead_days" BETWEEN 0 AND 28 AND "grace_days" BETWEEN 0 AND 28
  AND "late_fee_cents" >= 0 AND "min_partial_payment_cents" >= 0
);

-- Ledger sign rules (mirrors src/domain/ledger.ts validateLedgerAmount)
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_sign" CHECK (
  "amount_cents" <> 0 AND (
    ("type" IN ('RENT_CHARGE', 'LATE_FEE', 'OTHER_CHARGE', 'REFUND') AND "amount_cents" > 0) OR
    ("type" IN ('PAYMENT', 'CREDIT') AND "amount_cents" < 0) OR
    ("type" = 'ADJUSTMENT')
  )
);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_link" CHECK (
  "type" NOT IN ('PAYMENT', 'REFUND') OR "payment_id" IS NOT NULL
);

-- One active room assignment per room and per resident
CREATE UNIQUE INDEX "room_assignments_one_active_per_room" ON "room_assignments"("room_id") WHERE "end_date" IS NULL;
CREATE UNIQUE INDEX "room_assignments_one_active_per_resident" ON "room_assignments"("resident_id") WHERE "end_date" IS NULL;
-- One active rent schedule per resident
CREATE UNIQUE INDEX "rent_schedules_one_active_per_resident" ON "rent_schedules"("resident_id") WHERE "end_date" IS NULL;
-- One settlement ledger entry per payment per type (belt-and-braces with idempotency keys)
CREATE UNIQUE INDEX "ledger_entries_one_per_payment_type" ON "ledger_entries"("payment_id", "type") WHERE "payment_id" IS NOT NULL;

-- Append-only financial + audit history
CREATE OR REPLACE FUNCTION lil_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed (post a correcting entry instead)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION lil_forbid_mutation();
CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION lil_forbid_mutation();
CREATE TRIGGER "payment_events_append_only"
  BEFORE UPDATE OR DELETE ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION lil_forbid_mutation();

-- Payments: amount/resident/method are immutable once created; settled payments never deleted
CREATE OR REPLACE FUNCTION lil_guard_payment() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."amount_cents" <> OLD."amount_cents" OR NEW."resident_id" <> OLD."resident_id"
     OR NEW."method" <> OLD."method" OR NEW."provider" <> OLD."provider"
     OR NEW."receipt_number" <> OLD."receipt_number" THEN
    RAISE EXCEPTION 'payment amount/resident/method/provider/receipt are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" IN ('FAILED', 'REFUNDED', 'CANCELED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'payment in terminal status % cannot change', OLD."status"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'SUCCEEDED' AND NEW."status" NOT IN ('SUCCEEDED', 'REFUNDED') THEN
    RAISE EXCEPTION 'succeeded payment can only be refunded' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payments_guard"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION lil_guard_payment();

-- Residents with financial history are never hard-deleted (FKs RESTRICT), and
-- also block deletes outright so "move out" is the only exit path.
CREATE OR REPLACE FUNCTION lil_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted (archive / move out instead)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "residents_no_delete" BEFORE DELETE ON "residents" FOR EACH ROW EXECUTE FUNCTION lil_forbid_delete();
CREATE TRIGGER "rent_schedules_no_delete" BEFORE DELETE ON "rent_schedules" FOR EACH ROW EXECUTE FUNCTION lil_forbid_delete();
CREATE TRIGGER "room_assignments_no_delete" BEFORE DELETE ON "room_assignments" FOR EACH ROW EXECUTE FUNCTION lil_forbid_delete();

-- Settings singleton
INSERT INTO "settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP);
