-- Maintenance requests (resident repair reports) with timeline + photos.

ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_UPDATE';

CREATE TYPE "MaintenanceStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');
CREATE TYPE "MaintenanceCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'HEATING_COOLING', 'APPLIANCE', 'DOORS_LOCKS', 'PESTS', 'SAFETY', 'GENERAL');
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'NORMAL', 'URGENT');

CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "resident_id" TEXT NOT NULL,
    "property_id" TEXT,
    "room_id" TEXT,
    "category" "MaintenanceCategory" NOT NULL,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "permission_to_enter" BOOLEAN NOT NULL DEFAULT false,
    "entry_notes" TEXT,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "scheduled_for" TIMESTAMP(3),
    "assigned_to" TEXT,
    "completed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_updates" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "author_id" TEXT,
    "author_name" TEXT NOT NULL,
    "author_role" "Role" NOT NULL,
    "body" TEXT,
    "from_status" "MaintenanceStatus",
    "to_status" "MaintenanceStatus",
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "maintenance_updates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_photos" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "maintenance_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "maintenance_requests_number_key" ON "maintenance_requests"("number");
CREATE INDEX "maintenance_requests_status_priority_created_at_idx" ON "maintenance_requests"("status", "priority", "created_at");
CREATE INDEX "maintenance_requests_resident_id_created_at_idx" ON "maintenance_requests"("resident_id", "created_at");
CREATE INDEX "maintenance_requests_property_id_idx" ON "maintenance_requests"("property_id");
CREATE INDEX "maintenance_updates_request_id_created_at_idx" ON "maintenance_updates"("request_id", "created_at");
CREATE UNIQUE INDEX "maintenance_photos_storage_key_key" ON "maintenance_photos"("storage_key");
CREATE INDEX "maintenance_photos_request_id_idx" ON "maintenance_photos"("request_id");

ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_photos" ADD CONSTRAINT "maintenance_photos_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_text_present" CHECK (length(btrim("title")) > 0 AND length(btrim("description")) > 0);
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_completed_at" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL));
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_canceled_at" CHECK (("status" = 'CANCELED') = ("canceled_at" IS NOT NULL));
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_scheduled_has_date" CHECK ("status" <> 'SCHEDULED' OR "scheduled_for" IS NOT NULL);
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_has_content" CHECK (("body" IS NOT NULL AND length(btrim("body")) > 0) OR "to_status" IS NOT NULL);
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_internal_staff_only" CHECK (NOT "internal" OR "author_role" = 'ADMIN');
ALTER TABLE "maintenance_photos" ADD CONSTRAINT "maintenance_photos_size" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760);

-- History is permanent: timeline is append-only; requests/photos are never hard-deleted.
CREATE TRIGGER "maintenance_updates_append_only"
  BEFORE UPDATE OR DELETE ON "maintenance_updates"
  FOR EACH ROW EXECUTE FUNCTION lil_forbid_mutation();
CREATE TRIGGER "maintenance_requests_no_delete" BEFORE DELETE ON "maintenance_requests" FOR EACH ROW EXECUTE FUNCTION lil_forbid_delete();
CREATE TRIGGER "maintenance_photos_no_delete" BEFORE DELETE ON "maintenance_photos" FOR EACH ROW EXECUTE FUNCTION lil_forbid_delete();
