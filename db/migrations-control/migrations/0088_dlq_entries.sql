-- takos-migration-safety: expand
-- takos-migration-approval: Adds the missing append-only dead-letter queue ledger used by the existing run queue handler. No existing product rows are modified.
-- takos-migration-rollback: Roll application code back while retaining the table; Takos app migrations are forward-only and older readers ignore it.

CREATE TABLE IF NOT EXISTS "dlq_entries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "queue" TEXT NOT NULL,
  "message_body" TEXT,
  "error" TEXT,
  "retry_count" INTEGER,
  "created_at" TEXT NOT NULL
);
