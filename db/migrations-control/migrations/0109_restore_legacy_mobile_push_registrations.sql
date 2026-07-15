-- takos-migration-safety: expand
-- takos-migration-approval: Restores the legacy registration schema idempotently for any environment that applied the prematurely ordered 0102 contract migration, preserving old-Worker rollback compatibility while the replacement pusher path rolls out.
-- takos-migration-rollback: Keep this compatibility table through the rollback window. Remove it only in a later contract migration after the new Worker is fully deployed, rollback is retired, and backups are verified.

CREATE TABLE IF NOT EXISTS "mobile_push_registrations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "host_url" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mobile_push_registrations_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mobile_push_registrations_account_product_token"
  ON "mobile_push_registrations"("account_id", "product", "token_hash");

CREATE INDEX IF NOT EXISTS "idx_mobile_push_registrations_account_id"
  ON "mobile_push_registrations"("account_id");

CREATE INDEX IF NOT EXISTS "idx_mobile_push_registrations_last_seen_at"
  ON "mobile_push_registrations"("last_seen_at");
