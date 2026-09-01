-- takos-migration-safety: expand

-- Additive records for the agent-runtime cutover. New Workers commit the Run,
-- its enforced capability upper bound, and shadow context revision 1 in one D1
-- batch; no historical Run is assigned a synthesized revision.
CREATE TABLE IF NOT EXISTS "run_grants" (
  "run_id" TEXT PRIMARY KEY NOT NULL,
  "format_version" INTEGER NOT NULL DEFAULT 1
    CHECK ("format_version" = 1),
  "principal_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "parent_run_id" TEXT,
  "parent_grant_digest" TEXT,
  "enforcement_mode" TEXT NOT NULL DEFAULT 'enforced'
    CHECK ("enforcement_mode" IN ('shadow', 'enforced')),
  "grant_json" TEXT NOT NULL,
  "digest" TEXT NOT NULL
    CHECK (length("digest") = 71 AND "digest" LIKE 'sha256:%'),
  "created_at" TEXT NOT NULL,
  CHECK (
    ("parent_run_id" IS NULL AND "parent_grant_digest" IS NULL) OR
    ("parent_run_id" IS NOT NULL AND "parent_grant_digest" IS NOT NULL)
  ),
  CONSTRAINT "run_grants_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs" ("id"),
  CONSTRAINT "run_grants_principal_id_fkey"
    FOREIGN KEY ("principal_id") REFERENCES "accounts" ("id"),
  CONSTRAINT "run_grants_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "accounts" ("id"),
  CONSTRAINT "run_grants_parent_run_id_fkey"
    FOREIGN KEY ("parent_run_id") REFERENCES "runs" ("id")
);

CREATE INDEX IF NOT EXISTS "idx_run_grants_workspace_created_at"
  ON "run_grants" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_run_grants_principal_created_at"
  ON "run_grants" ("principal_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_run_grants_parent_run_id"
  ON "run_grants" ("parent_run_id");

CREATE TABLE IF NOT EXISTS "run_context_revisions" (
  "run_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" >= 1),
  "parent_revision" INTEGER,
  "activation_event_id" INTEGER,
  "format_version" INTEGER NOT NULL DEFAULT 1
    CHECK ("format_version" = 1),
  "principal_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "transcript_cut_sequence" INTEGER NOT NULL
    CHECK ("transcript_cut_sequence" >= -1),
  "agent_profile_revision" TEXT NOT NULL,
  "model_revision" TEXT NOT NULL,
  "system_prompt_revision" TEXT NOT NULL,
  "run_grant_digest" TEXT NOT NULL,
  "record_mode" TEXT NOT NULL DEFAULT 'shadow'
    CHECK ("record_mode" IN ('shadow', 'authoritative')),
  "context_json" TEXT NOT NULL,
  "digest" TEXT NOT NULL
    CHECK (length("digest") = 71 AND "digest" LIKE 'sha256:%'),
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("run_id", "revision"),
  CHECK (
    ("revision" = 1 AND "parent_revision" IS NULL) OR
    ("revision" > 1 AND "parent_revision" = "revision" - 1)
  ),
  CONSTRAINT "run_context_revisions_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs" ("id"),
  CONSTRAINT "run_context_revisions_principal_id_fkey"
    FOREIGN KEY ("principal_id") REFERENCES "accounts" ("id"),
  CONSTRAINT "run_context_revisions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "accounts" ("id"),
  CONSTRAINT "run_context_revisions_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads" ("id")
);

CREATE INDEX IF NOT EXISTS "idx_run_context_revisions_workspace_created_at"
  ON "run_context_revisions" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_run_context_revisions_thread_created_at"
  ON "run_context_revisions" ("thread_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_run_context_revisions_grant_digest"
  ON "run_context_revisions" ("run_grant_digest");

-- Exact, immutable origin identity for a high-risk MCP invocation. Existing
-- confirmation rows deliberately receive no synthesized identity and remain
-- non-authoritative until they expire.
CREATE TABLE IF NOT EXISTS "mcp_tool_confirmation_identities" (
  "confirmation_id" TEXT PRIMARY KEY NOT NULL,
  "identity_version" INTEGER NOT NULL DEFAULT 1
    CHECK ("identity_version" = 1),
  "principal_id" TEXT NOT NULL,
  "requested_run_id" TEXT NOT NULL,
  "requested_thread_id" TEXT NOT NULL,
  "run_context_revision" INTEGER NOT NULL
    CHECK ("run_context_revision" = 1),
  "run_context_digest" TEXT NOT NULL
    CHECK (length("run_context_digest") = 71 AND "run_context_digest" LIKE 'sha256:%'),
  "run_grant_digest" TEXT NOT NULL
    CHECK (length("run_grant_digest") = 71 AND "run_grant_digest" LIKE 'sha256:%'),
  "requested_tool_call_id" TEXT NOT NULL,
  "identity_hash" TEXT NOT NULL
    CHECK (length("identity_hash") = 64),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "mcp_tool_confirmation_identities_confirmation_id_fkey"
    FOREIGN KEY ("confirmation_id") REFERENCES "mcp_tool_confirmations" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "mcp_tool_confirmation_identities_principal_id_fkey"
    FOREIGN KEY ("principal_id") REFERENCES "accounts" ("id"),
  CONSTRAINT "mcp_tool_confirmation_identities_requested_run_id_fkey"
    FOREIGN KEY ("requested_run_id") REFERENCES "runs" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "mcp_tool_confirmation_identities_requested_thread_id_fkey"
    FOREIGN KEY ("requested_thread_id") REFERENCES "threads" ("id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mcp_tool_confirmation_identities_identity_hash"
  ON "mcp_tool_confirmation_identities" ("identity_hash");
CREATE INDEX IF NOT EXISTS "idx_mcp_tool_confirmation_identities_requested_run_id"
  ON "mcp_tool_confirmation_identities" ("requested_run_id");

-- An approval can be delegated to exactly one Run. This row is inserted in the
-- same atomic batch as that Run, its RunGrant, and context revision.
CREATE TABLE IF NOT EXISTS "mcp_confirmation_run_grants" (
  "confirmation_id" TEXT PRIMARY KEY NOT NULL,
  "run_id" TEXT NOT NULL,
  "principal_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "run_context_revision" INTEGER NOT NULL
    CHECK ("run_context_revision" = 1),
  "run_context_digest" TEXT NOT NULL
    CHECK (length("run_context_digest") = 71 AND "run_context_digest" LIKE 'sha256:%'),
  "run_grant_digest" TEXT NOT NULL
    CHECK (length("run_grant_digest") = 71 AND "run_grant_digest" LIKE 'sha256:%'),
  "origin_identity_hash" TEXT NOT NULL
    CHECK (length("origin_identity_hash") = 64),
  "consumed_tool_call_id" TEXT,
  "consumed_at" TEXT,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "mcp_confirmation_run_grants_confirmation_id_fkey"
    FOREIGN KEY ("confirmation_id") REFERENCES "mcp_tool_confirmations" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "mcp_confirmation_run_grants_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "mcp_confirmation_run_grants_principal_id_fkey"
    FOREIGN KEY ("principal_id") REFERENCES "accounts" ("id"),
  CONSTRAINT "mcp_confirmation_run_grants_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "accounts" ("id"),
  CONSTRAINT "mcp_confirmation_run_grants_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads" ("id"),
  CHECK (
    ("consumed_tool_call_id" IS NULL AND "consumed_at" IS NULL) OR
    ("consumed_tool_call_id" IS NOT NULL AND "consumed_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mcp_confirmation_run_grants_run_id"
  ON "mcp_confirmation_run_grants" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_mcp_confirmation_run_grants_workspace_created_at"
  ON "mcp_confirmation_run_grants" ("workspace_id", "created_at");
