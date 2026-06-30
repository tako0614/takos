-- takos-migration-safety: expand
-- takos-migration-approval: Adds an additive product-local table for mobile client push tokens. No existing data is changed, and tokens are scoped to the authenticated Takos account that registered them.
-- takos-migration-rollback: Drop idx_mobile_push_registrations_last_seen_at, idx_mobile_push_registrations_account_id, idx_mobile_push_registrations_account_product_token, then drop mobile_push_registrations.

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
