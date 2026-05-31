ALTER TABLE "worker_env_vars" RENAME TO "service_env_vars";
ALTER TABLE "worker_mcp_endpoints" RENAME TO "service_mcp_endpoints";
ALTER TABLE "worker_runtime_flags" RENAME TO "service_runtime_flags";
ALTER TABLE "worker_runtime_limits" RENAME TO "service_runtime_limits";
ALTER TABLE "worker_runtime_settings" RENAME TO "service_runtime_settings";

DROP INDEX IF EXISTS "idx_worker_env_vars_account_id";
CREATE INDEX IF NOT EXISTS "idx_service_env_vars_account_id"
  ON "service_env_vars" ("account_id");

DROP INDEX IF EXISTS "idx_worker_runtime_settings_account_id";
CREATE INDEX IF NOT EXISTS "idx_service_runtime_settings_account_id"
  ON "service_runtime_settings" ("account_id");
