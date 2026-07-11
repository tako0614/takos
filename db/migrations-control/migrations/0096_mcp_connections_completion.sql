-- takos-migration-safety: expand
-- takos-migration-approval: Adds encrypted Registry credentials, explicit external-tool invocation policy, and short-lived one-time MCP invocation confirmations for exact external or high-risk managed calls without exposing existing secrets or enabling any new tool.
-- takos-migration-rollback: Roll application code back while retaining additive nullable/defaulted columns and the confirmation audit table; older Takos versions ignore them and Takos app migrations are forward-only.

ALTER TABLE "mcp_registry_sources" ADD COLUMN "auth_type" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "mcp_registry_sources" ADD COLUMN "auth_header_name" TEXT;
ALTER TABLE "mcp_registry_sources" ADD COLUMN "auth_secret" TEXT;

-- Existing reviewed external tools fail safer after upgrade: an enabled tool
-- still remains exposed, but each invocation requires a one-time user decision
-- until an editor deliberately changes the policy to automatic execution.
ALTER TABLE "mcp_tool_policies" ADD COLUMN "invocation_policy" TEXT NOT NULL DEFAULT 'confirm_each_time';

CREATE TABLE IF NOT EXISTS "mcp_tool_confirmations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "server_id" TEXT NOT NULL,
  "server_name" TEXT NOT NULL,
  "tool_name" TEXT NOT NULL,
  "schema_hash" TEXT NOT NULL,
  "arguments_hash" TEXT NOT NULL,
  "arguments_ciphertext" TEXT NOT NULL,
  "requested_run_id" TEXT NOT NULL,
  "requested_thread_id" TEXT NOT NULL,
  "consumed_run_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expires_at" DATETIME NOT NULL,
  "decided_at" DATETIME,
  "consumed_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_tool_confirmations_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mcp_tool_confirmations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "accounts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_mcp_tool_confirmations_account_user_status_expiry"
  ON "mcp_tool_confirmations"("account_id", "user_id", "status", "expires_at");

CREATE INDEX IF NOT EXISTS "idx_mcp_tool_confirmations_invocation_match"
  ON "mcp_tool_confirmations"(
    "account_id",
    "user_id",
    "server_id",
    "tool_name",
    "schema_hash",
    "arguments_hash"
  );
