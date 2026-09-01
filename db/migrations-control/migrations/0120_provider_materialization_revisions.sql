-- takos-migration-safety: expand

-- A provider materialization pins only the secret-free meaning of the model
-- transport selected for one Run. Short-lived tokens and deployment keys are
-- resolved live immediately after model-call authority is committed and never
-- enter this table or the RunContext JSON.
CREATE TABLE IF NOT EXISTS "provider_materialization_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "source_kind" TEXT NOT NULL
    CHECK (
      "source_kind" IN (
        'local_smoke',
        'deployment_shared_key',
        'takosumi_interface'
      )
    ),
  "protocol" TEXT NOT NULL
    CHECK (
      "protocol" IN ('local_smoke', 'openai_chat_completions')
    ),
  "endpoint" TEXT,
  "materialization_digest" TEXT NOT NULL
    CHECK (
      length("materialization_digest") = 71 AND
      "materialization_digest" LIKE 'sha256:%'
    ),
  "materialization_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "provider_materialization_revisions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "provider_materialization_revisions_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs" ("id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_provider_materialization_revisions_run"
  ON "provider_materialization_revisions" ("run_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_provider_materialization_revisions_content"
  ON "provider_materialization_revisions" (
    "account_id",
    "resource_id",
    "materialization_digest"
  );

-- Provider materializations have live external-revocation semantics rather
-- than Takos deletion-tombstone semantics. Keep their references separate
-- from migration 0114's protected deletion-authority table, as tool
-- descriptors already do for their own live adapter contract.
CREATE TABLE IF NOT EXISTS "run_context_provider_materialization_refs" (
  "run_id" TEXT NOT NULL,
  "context_revision" INTEGER NOT NULL CHECK ("context_revision" >= 1),
  "workspace_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "resource_digest" TEXT NOT NULL
    CHECK (
      length("resource_digest") = 71 AND
      "resource_digest" LIKE 'sha256:%'
    ),
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("run_id", "context_revision", "resource_id"),
  CONSTRAINT "run_context_provider_materialization_refs_revision_fkey"
    FOREIGN KEY ("run_id", "context_revision")
      REFERENCES "run_context_revisions" ("run_id", "revision")
      ON DELETE CASCADE,
  CONSTRAINT "run_context_provider_materialization_refs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "run_context_provider_materialization_refs_resource_fkey"
    FOREIGN KEY ("workspace_id", "resource_id", "resource_digest")
      REFERENCES "provider_materialization_revisions" (
        "account_id",
        "resource_id",
        "materialization_digest"
      )
      ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_run_context_provider_materialization_refs_resource"
  ON "run_context_provider_materialization_refs" (
    "workspace_id",
    "resource_id",
    "run_id",
    "context_revision"
  );
