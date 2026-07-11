-- takos-migration-safety: expand
-- takos-migration-approval: Adds default-deny, Workspace-scoped exposure snapshots for tools advertised by real external MCP server rows.
-- takos-migration-rollback: Roll application code back while retaining the additive table; older Takos versions ignore it and deleting an MCP server still removes its policy rows.

CREATE TABLE IF NOT EXISTS "mcp_tool_policies" (
  "account_id" TEXT NOT NULL,
  "server_id" TEXT NOT NULL,
  "tool_name" TEXT NOT NULL,
  "schema_hash" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL DEFAULT 0,
  "first_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" DATETIME,
  CONSTRAINT "mcp_tool_policies_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_tool_policies_server_id_fkey"
    FOREIGN KEY ("server_id") REFERENCES "mcp_servers" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mcp_tool_policies_account_server_tool"
  ON "mcp_tool_policies"("account_id", "server_id", "tool_name");

CREATE INDEX IF NOT EXISTS "idx_mcp_tool_policies_account_server_enabled"
  ON "mcp_tool_policies"("account_id", "server_id", "enabled");
