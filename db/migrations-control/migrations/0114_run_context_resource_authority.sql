-- takos-migration-safety: expand

-- A Run points at exactly one immutable context revision. Historical Runs stay
-- NULL instead of receiving a synthesized context; new writers set revision 1
-- in the same atomic batch as the Run and its base records.
ALTER TABLE "runs" ADD COLUMN "current_context_revision" INTEGER
  CHECK (
    "current_context_revision" IS NULL OR "current_context_revision" >= 1
  );

-- Machine-readable terminal causes are separate from user-facing error text.
-- The initial vocabulary covers context revocation and integrity failure only.
ALTER TABLE "runs" ADD COLUMN "terminal_reason" TEXT
  CHECK (
    "terminal_reason" IS NULL OR
    "terminal_reason" IN ('context_revoked', 'context_invalid')
  );

-- Worker-owned activation keys make an in-Run append idempotent across RPC
-- response loss. NULL remains valid for the base revision.
ALTER TABLE "run_context_revisions" ADD COLUMN "activation_event_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_run_context_revisions_activation_event_key"
  ON "run_context_revisions" ("run_id", "activation_event_key");

-- Exact resource references are normalized so deletion and live execution
-- fences never need to search mutable JSON. Every revision owns its complete
-- reference set; the JSON snapshot and these rows must agree byte-for-byte on
-- id/digest identity before execution is authorized.
CREATE TABLE IF NOT EXISTS "run_context_resource_refs" (
  "run_id" TEXT NOT NULL,
  "context_revision" INTEGER NOT NULL CHECK ("context_revision" >= 1),
  "workspace_id" TEXT NOT NULL,
  "resource_kind" TEXT NOT NULL
    CHECK (
      "resource_kind" IN (
        'explicit_memory',
        'turn_projection',
        'skill_revision',
        'artifact'
      )
    ),
  "resource_id" TEXT NOT NULL,
  "resource_digest" TEXT NOT NULL
    CHECK (
      length("resource_digest") = 71 AND
      "resource_digest" LIKE 'sha256:%'
    ),
  "created_at" TEXT NOT NULL,
  PRIMARY KEY (
    "run_id",
    "context_revision",
    "resource_kind",
    "resource_id"
  ),
  CONSTRAINT "run_context_resource_refs_revision_fkey"
    FOREIGN KEY ("run_id", "context_revision")
      REFERENCES "run_context_revisions" ("run_id", "revision")
      ON DELETE CASCADE,
  CONSTRAINT "run_context_resource_refs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_run_context_resource_refs_resource"
  ON "run_context_resource_refs" (
    "workspace_id",
    "resource_kind",
    "resource_id",
    "run_id",
    "context_revision"
  );

-- Migration 0112 intentionally fixed the legacy confirmation columns to base
-- revision 1 because a confirmation grant is claimed by the next Run's base
-- authority. These nullable extension fields additionally bind new request
-- identities to the origin Run's active progressive revision without changing
-- that one-Run claim contract. Legacy rows remain readable through the v1
-- branch and receive no synthesized extension.
ALTER TABLE "mcp_tool_confirmation_identities"
  ADD COLUMN "identity_extension_version" INTEGER
    CHECK (
      "identity_extension_version" IS NULL OR
      "identity_extension_version" = 1
    );

ALTER TABLE "mcp_tool_confirmation_identities"
  ADD COLUMN "active_context_revision" INTEGER
    CHECK (
      "active_context_revision" IS NULL OR
      "active_context_revision" >= 1
    );

ALTER TABLE "mcp_tool_confirmation_identities"
  ADD COLUMN "active_context_digest" TEXT
    CHECK (
      "active_context_digest" IS NULL OR
      (
        length("active_context_digest") = 71 AND
        "active_context_digest" LIKE 'sha256:%'
      )
    );
