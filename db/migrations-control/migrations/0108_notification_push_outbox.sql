-- takos-migration-safety: expand
-- takos-migration-approval: Notification Queue delivery needs an event-id-only durable replay owner so a gateway outage through the main Queue and DLQ cannot permanently lose a push.
-- takos-migration-rollback: stop producers and drain notification_push_outbox, then drop idx_notification_push_outbox_status_claimed_at and notification_push_outbox.

CREATE TABLE IF NOT EXISTS "notification_push_outbox" (
  "notification_id" TEXT NOT NULL PRIMARY KEY,
  "delivery_status" TEXT NOT NULL DEFAULT 'queued'
    CHECK ("delivery_status" IN ('queued', 'dispatching', 'enqueued', 'done')),
  "claim_token" TEXT,
  "claimed_at" DATETIME,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_push_outbox_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_notification_push_outbox_status_claimed_at"
  ON "notification_push_outbox"("delivery_status", "claimed_at");
