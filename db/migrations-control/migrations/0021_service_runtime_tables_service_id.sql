ALTER TABLE "worker_env_vars" RENAME COLUMN "worker_id" TO "service_id";
DROP INDEX IF EXISTS "idx_worker_env_vars_worker_name";
DROP INDEX IF EXISTS "idx_worker_env_vars_worker_id";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_env_vars_service_name"
  ON "worker_env_vars" ("service_id", "name");
CREATE INDEX IF NOT EXISTS "idx_service_env_vars_service_id"
  ON "worker_env_vars" ("service_id");

ALTER TABLE "worker_mcp_endpoints" RENAME COLUMN "worker_id" TO "service_id";
ALTER TABLE "worker_runtime_flags" RENAME COLUMN "worker_id" TO "service_id";
ALTER TABLE "worker_runtime_limits" RENAME COLUMN "worker_id" TO "service_id";
ALTER TABLE "worker_runtime_settings" RENAME COLUMN "worker_id" TO "service_id";
DROP INDEX IF EXISTS "idx_worker_runtime_settings_account_id";
CREATE INDEX IF NOT EXISTS "idx_service_runtime_settings_account_id"
  ON "worker_runtime_settings" ("account_id");
