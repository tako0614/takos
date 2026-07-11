-- takos-migration-safety: expand
-- takos-migration-approval: Adds Workspace-scoped MCP Registry discovery sources and built-in source preferences without changing existing MCP server connections or credentials.
-- takos-migration-rollback: Roll application code back while retaining the additive table; older Takos versions ignore it.

CREATE TABLE IF NOT EXISTS "mcp_registry_sources" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "source_kind" TEXT NOT NULL DEFAULT 'custom',
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_registry_sources_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mcp_registry_sources_account_base_url"
  ON "mcp_registry_sources"("account_id", "base_url");

CREATE INDEX IF NOT EXISTS "idx_mcp_registry_sources_account_enabled_priority"
  ON "mcp_registry_sources"("account_id", "enabled", "priority");
