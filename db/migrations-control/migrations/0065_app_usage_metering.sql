-- App-local usage metering. Commercial billing is owned by Takosumi Accounts.
-- takos-migration-safety: expand

CREATE TABLE IF NOT EXISTS "app_usage_events" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotency_key" TEXT,
  "owner_account_id" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL DEFAULT 'space',
  "space_id" TEXT,
  "meter_type" TEXT NOT NULL,
  "units" REAL NOT NULL,
  "reference_id" TEXT,
  "reference_type" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_usage_events_idempotency_key"
  ON "app_usage_events" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_app_usage_events_owner_account_id"
  ON "app_usage_events" ("owner_account_id");
CREATE INDEX IF NOT EXISTS "idx_app_usage_events_space_id"
  ON "app_usage_events" ("space_id");
CREATE INDEX IF NOT EXISTS "idx_app_usage_events_meter_type"
  ON "app_usage_events" ("meter_type");
CREATE INDEX IF NOT EXISTS "idx_app_usage_events_reference_id"
  ON "app_usage_events" ("reference_id");
CREATE INDEX IF NOT EXISTS "idx_app_usage_events_created_at"
  ON "app_usage_events" ("created_at");

CREATE TABLE IF NOT EXISTS "app_usage_rollups" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "owner_account_id" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  "space_id" TEXT,
  "meter_type" TEXT NOT NULL,
  "period_start" TEXT NOT NULL,
  "units" REAL NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_usage_rollups_scope"
  ON "app_usage_rollups" (
    "owner_account_id",
    "scope_type",
    "scope_id",
    "meter_type",
    "period_start"
  );
CREATE INDEX IF NOT EXISTS "idx_app_usage_rollups_owner_account_id"
  ON "app_usage_rollups" ("owner_account_id");
CREATE INDEX IF NOT EXISTS "idx_app_usage_rollups_space_id"
  ON "app_usage_rollups" ("space_id");
CREATE INDEX IF NOT EXISTS "idx_app_usage_rollups_meter_type"
  ON "app_usage_rollups" ("meter_type");
CREATE INDEX IF NOT EXISTS "idx_app_usage_rollups_period_start"
  ON "app_usage_rollups" ("period_start");
