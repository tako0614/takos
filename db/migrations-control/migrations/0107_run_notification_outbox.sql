-- takos-migration-safety: expand
-- takos-migration-approval: Terminal Run transitions need a durable notification outbox committed in the same transaction so transient inbox or Queue failures cannot permanently lose the user-visible outcome.
-- takos-migration-rollback: drop idx_run_notification_outbox_status_claimed_at, idx_run_notification_outbox_run_id, idx_run_notification_outbox_completion_key, then drop run_notification_outbox after every queued row is drained.

CREATE TABLE IF NOT EXISTS "run_notification_outbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "completion_key" TEXT NOT NULL,
  "run_status" TEXT NOT NULL CHECK ("run_status" IN ('completed', 'failed')),
  "delivery_status" TEXT NOT NULL DEFAULT 'queued'
    CHECK ("delivery_status" IN ('queued', 'dispatching', 'done')),
  "claim_token" TEXT,
  "claimed_at" DATETIME,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "run_notification_outbox_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_run_notification_outbox_completion_key"
  ON "run_notification_outbox"("completion_key");

CREATE INDEX IF NOT EXISTS "idx_run_notification_outbox_run_id"
  ON "run_notification_outbox"("run_id");

CREATE INDEX IF NOT EXISTS "idx_run_notification_outbox_status_claimed_at"
  ON "run_notification_outbox"("delivery_status", "claimed_at");
