-- Push notification devices: Web Push (PWA) and APNs (iOS app).
CREATE TYPE "PushKind" AS ENUM ('WEB', 'APNS');

CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "PushKind" NOT NULL,
    "endpoint" TEXT,
    "p256dh" TEXT,
    "auth" TEXT,
    "apns_token" TEXT,
    "label" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_success_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE UNIQUE INDEX "push_subscriptions_apns_token_key" ON "push_subscriptions"("apns_token");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A WEB row carries endpoint + keys; an APNS row carries only a device token.
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_shape" CHECK (
  ("kind" = 'WEB' AND "endpoint" LIKE 'https://%' AND "p256dh" IS NOT NULL AND "auth" IS NOT NULL AND "apns_token" IS NULL) OR
  ("kind" = 'APNS' AND "apns_token" ~ '^[0-9a-f]{64,200}$' AND "endpoint" IS NULL)
);
