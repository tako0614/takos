-- takos-migration-safety: expand

CREATE TABLE IF NOT EXISTS "workspace_deletion_receipts" (
  "operation_id" TEXT PRIMARY KEY NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "requested_by_user_id" TEXT NOT NULL,
  "request_signature" TEXT NOT NULL,
  "deleted_at" TEXT NOT NULL,
  CONSTRAINT "workspace_deletion_receipts_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "accounts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS
  "idx_workspace_deletion_receipts_workspace_id"
  ON "workspace_deletion_receipts" ("workspace_id");

CREATE INDEX IF NOT EXISTS
  "idx_workspace_deletion_receipts_requested_by_user_id"
  ON "workspace_deletion_receipts" ("requested_by_user_id");

CREATE INDEX IF NOT EXISTS "idx_workspace_deletion_receipts_deleted_at"
  ON "workspace_deletion_receipts" ("deleted_at");

-- Keep the final account-row transition fail-closed if content appears after
-- the service preflight but before its atomic receipt + delete batch. The
-- preflight owns the user-facing category; this trigger owns the race.
CREATE TRIGGER IF NOT EXISTS "workspace_delete_requires_empty"
BEFORE DELETE ON "accounts"
WHEN OLD."type" = 'team' AND (
  EXISTS (SELECT 1 FROM "threads" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "runs" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "agent_tasks" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "memories" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "memory_claims" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "memory_evidence" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "memory_claim_edges" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "memory_paths" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "reminders" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "skills" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "account_storage_files" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "files" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "chunks" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "index_jobs" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "info_units" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "account_env_vars" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "mcp_oauth_pending" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "mcp_registry_sources" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "mcp_servers" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "mcp_tool_confirmations" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "mcp_tool_policies" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "repositories" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "snapshots" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "blobs" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "sessions" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "apps" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "services" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "bundle_deployments" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "deployments" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "groups" WHERE "space_id" = OLD."id") OR
  EXISTS (
    SELECT 1 FROM "resources"
    WHERE "account_id" = OLD."id" OR "owner_account_id" = OLD."id"
  ) OR
  EXISTS (SELECT 1 FROM "edges" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "nodes" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "infra_endpoints" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "file_handlers" WHERE "account_id" = OLD."id") OR
  EXISTS (SELECT 1 FROM "ui_extensions" WHERE "account_id" = OLD."id") OR
  EXISTS (
    SELECT 1 FROM "featured_app_preinstall_jobs"
    WHERE "space_id" = OLD."id"
  )
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_not_empty');
END;
