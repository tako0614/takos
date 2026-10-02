-- takos-migration-safety: expand
-- Terminal SQL commits one owner-bound usage recovery witness. Apply before the Worker that writes it.
CREATE TABLE IF NOT EXISTS "run_usage_projection_outbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "completion_key" TEXT NOT NULL,
  "run_status" TEXT NOT NULL CHECK ("run_status" IN ('completed', 'failed', 'cancelled')),
  "workspace_id" TEXT NOT NULL,
  "owner_account_id" TEXT NOT NULL,
  "delivery_status" TEXT NOT NULL DEFAULT 'queued'
    CHECK ("delivery_status" IN ('queued', 'dispatching', 'done', 'blocked')),
  "claim_token" TEXT,
  "claimed_at" DATETIME,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" DATETIME,
  "last_error" TEXT,
  "projected_revision" INTEGER,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "run_usage_projection_outbox_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs" ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_run_usage_projection_outbox_run"
  ON "run_usage_projection_outbox" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_run_usage_projection_outbox_due"
  ON "run_usage_projection_outbox" ("delivery_status", "next_attempt_at", "claimed_at");

-- The projection group creates and removes one assertion row atomically. Its
-- NOT NULL constraint fails closed if a locked authority row changed.
CREATE TABLE IF NOT EXISTS "run_usage_projection_assertions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "valid" INTEGER NOT NULL
);
