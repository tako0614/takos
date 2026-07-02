-- takos-migration-safety: expand
-- takos-migration-approval: Adds an additive product-neutral notification pusher table. Existing notification rows and mobile push registrations are unchanged.
-- takos-migration-rollback: Drop idx_notification_pushers_last_seen_at, idx_notification_pushers_product, idx_notification_pushers_account_id, idx_notification_pushers_account_app_pushkey, then drop notification_pushers.

CREATE TABLE IF NOT EXISTS "notification_pushers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "product" TEXT,
  "scope" TEXT,
  "kind" TEXT NOT NULL,
  "app_id" TEXT NOT NULL,
  "pushkey" TEXT NOT NULL,
  "pushkey_hash" TEXT NOT NULL,
  "app_display_name" TEXT,
  "device_display_name" TEXT,
  "profile_tag" TEXT,
  "lang" TEXT,
  "gateway_url" TEXT NOT NULL,
  "data" TEXT NOT NULL DEFAULT '{}',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_pushers_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_notification_pushers_account_app_pushkey"
  ON "notification_pushers"("account_id", "app_id", "pushkey_hash");

CREATE INDEX IF NOT EXISTS "idx_notification_pushers_account_id"
  ON "notification_pushers"("account_id");

CREATE INDEX IF NOT EXISTS "idx_notification_pushers_product"
  ON "notification_pushers"("product");

CREATE INDEX IF NOT EXISTS "idx_notification_pushers_last_seen_at"
  ON "notification_pushers"("last_seen_at");
