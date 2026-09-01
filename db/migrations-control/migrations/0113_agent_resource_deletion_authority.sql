-- takos-migration-safety: expand
-- takos-migration-approval: Agent resource deletion needs a content-free SQL tombstone committed with the source removal and an exact-target durable outbox so delayed vector/object cleanup cannot make deleted content authoritative again.
-- takos-migration-rollback: stop new tombstone writers, drain or explicitly waive every pending agent_resource_deletion_outbox row, then drop the outbox and tombstone tables. Source rows already deleted are not reconstructed.

CREATE TABLE IF NOT EXISTS "agent_resource_tombstones" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "account_id" TEXT NOT NULL,
  "resource_kind" TEXT NOT NULL
    CHECK ("resource_kind" IN (
      'explicit_memory',
      'turn_projection',
      'skill_revision',
      'artifact'
    )),
  "resource_id" TEXT NOT NULL,
  "source_digest" TEXT NOT NULL
    CHECK (length("source_digest") = 71 AND "source_digest" LIKE 'sha256:%'),
  "deleted_by_account_id" TEXT,
  "deleted_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "agent_resource_tombstones_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "agent_resource_tombstones_deleted_by_account_id_fkey"
    FOREIGN KEY ("deleted_by_account_id") REFERENCES "accounts" ("id")
      ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_resource_tombstones_resource"
  ON "agent_resource_tombstones" (
    "account_id", "resource_kind", "resource_id"
  );
CREATE INDEX IF NOT EXISTS "idx_agent_resource_tombstones_account_deleted_at"
  ON "agent_resource_tombstones" ("account_id", "deleted_at");

CREATE TABLE IF NOT EXISTS "agent_resource_deletion_outbox" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "account_id" TEXT NOT NULL,
  "resource_kind" TEXT NOT NULL
    CHECK ("resource_kind" IN (
      'explicit_memory',
      'turn_projection',
      'skill_revision',
      'artifact'
    )),
  "resource_id" TEXT NOT NULL,
  "vector_ids" TEXT NOT NULL DEFAULT '[]',
  "offload_object_keys" TEXT NOT NULL DEFAULT '[]',
  "delivery_status" TEXT NOT NULL DEFAULT 'pending'
    CHECK ("delivery_status" IN (
      'pending', 'processing', 'retry_wait', 'done', 'failed'
    )),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "claim_token" TEXT,
  "claimed_at" TEXT,
  "next_attempt_at" TEXT,
  "completed_at" TEXT,
  "last_error" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CHECK (
    ("delivery_status" = 'processing' AND "claim_token" IS NOT NULL AND "claimed_at" IS NOT NULL) OR
    ("delivery_status" <> 'processing' AND "claim_token" IS NULL)
  ),
  CHECK (
    ("delivery_status" = 'done' AND "completed_at" IS NOT NULL) OR
    ("delivery_status" <> 'done')
  ),
  CONSTRAINT "agent_resource_deletion_outbox_id_fkey"
    FOREIGN KEY ("id") REFERENCES "agent_resource_tombstones" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "agent_resource_deletion_outbox_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_resource_deletion_outbox_resource"
  ON "agent_resource_deletion_outbox" (
    "account_id", "resource_kind", "resource_id"
  );
CREATE INDEX IF NOT EXISTS "idx_agent_resource_deletion_outbox_status_next_attempt"
  ON "agent_resource_deletion_outbox" (
    "delivery_status", "next_attempt_at", "claimed_at"
  );
