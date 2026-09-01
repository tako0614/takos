-- takos-migration-safety: expand

-- Exact tool meaning is stored independently from mutable native/MCP
-- catalogs. The snapshot contains bounded public contract metadata and an
-- opaque adapter identity only; credentials, endpoint tokens, arguments, and
-- tool results never enter this table.
CREATE TABLE IF NOT EXISTS "tool_descriptor_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "logical_name" TEXT NOT NULL,
  "source" TEXT NOT NULL CHECK ("source" IN ('native', 'mcp')),
  "adapter_reference" TEXT NOT NULL,
  "adapter_revision" TEXT NOT NULL,
  "schema_digest" TEXT NOT NULL
    CHECK (
      length("schema_digest") = 71 AND
      "schema_digest" LIKE 'sha256:%'
    ),
  "descriptor_digest" TEXT NOT NULL
    CHECK (
      length("descriptor_digest") = 71 AND
      "descriptor_digest" LIKE 'sha256:%'
    ),
  "descriptor_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "tool_descriptor_revisions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tool_descriptor_revisions_content"
  ON "tool_descriptor_revisions" (
    "account_id",
    "resource_id",
    "descriptor_digest"
  );

CREATE INDEX IF NOT EXISTS "idx_tool_descriptor_revisions_logical_name"
  ON "tool_descriptor_revisions" (
    "account_id",
    "logical_name",
    "created_at"
  );

-- Migration 0114 deliberately limits deletion-bearing resource kinds. Tool
-- descriptors have different live semantics (native release/MCP connection +
-- policy revalidation), so they use a separate append-only reference table
-- instead of rebuilding the protected deletion-authority table in place.
CREATE TABLE IF NOT EXISTS "run_context_tool_descriptor_refs" (
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
  PRIMARY KEY (
    "run_id",
    "context_revision",
    "resource_id"
  ),
  CONSTRAINT "run_context_tool_descriptor_refs_revision_fkey"
    FOREIGN KEY ("run_id", "context_revision")
      REFERENCES "run_context_revisions" ("run_id", "revision")
      ON DELETE CASCADE,
  CONSTRAINT "run_context_tool_descriptor_refs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_run_context_tool_descriptor_refs_resource"
  ON "run_context_tool_descriptor_refs" (
    "workspace_id",
    "resource_id",
    "run_id",
    "context_revision"
  );
