ALTER TABLE "common_env_audit_logs" RENAME COLUMN "worker_id" TO "service_id";
DROP INDEX IF EXISTS "idx_common_env_audit_logs_worker_created_at";
CREATE INDEX IF NOT EXISTS "idx_common_env_audit_logs_service_created_at"
  ON "common_env_audit_logs" ("service_id", "created_at");

DROP INDEX IF EXISTS "idx_common_env_reconcile_jobs_account_worker_status";
CREATE INDEX IF NOT EXISTS "idx_common_env_reconcile_jobs_account_service_status"
  ON "common_env_reconcile_jobs" ("account_id", "service_id", "status");

DROP INDEX IF EXISTS "idx_custom_domains_worker_id";
CREATE INDEX IF NOT EXISTS "idx_custom_domains_service_id"
  ON "custom_domains" ("service_id");

DROP INDEX IF EXISTS "idx_managed_takos_tokens_worker_env";
DROP INDEX IF EXISTS "idx_managed_takos_tokens_worker_id";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_managed_takos_tokens_service_env"
  ON "managed_takos_tokens" ("service_id", "env_name");
CREATE INDEX IF NOT EXISTS "idx_managed_takos_tokens_service_id"
  ON "managed_takos_tokens" ("service_id");
