ALTER TABLE "mcp_servers" RENAME COLUMN "worker_id" TO "service_id";
DROP INDEX IF EXISTS "idx_mcp_servers_worker_id";
CREATE INDEX IF NOT EXISTS "idx_mcp_servers_service_id" ON "mcp_servers" ("service_id");
