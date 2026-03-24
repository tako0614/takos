PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS "__new_common_env_reconcile_jobs";
CREATE TABLE "__new_common_env_reconcile_jobs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "target_keys_json" TEXT,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" DATETIME,
  "lease_token" TEXT,
  "lease_expires_at" DATETIME,
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "enqueued_at" DATETIME,
  "started_at" DATETIME,
  "completed_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "common_env_reconcile_jobs_service_id_account_id_fkey"
    FOREIGN KEY ("service_id", "account_id") REFERENCES "services" ("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "common_env_reconcile_jobs_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "__new_common_env_reconcile_jobs" (
  "id",
  "account_id",
  "service_id",
  "target_keys_json",
  "trigger",
  "status",
  "attempts",
  "next_attempt_at",
  "lease_token",
  "lease_expires_at",
  "last_error_code",
  "last_error_message",
  "enqueued_at",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "account_id",
  "worker_id",
  "target_keys_json",
  "trigger",
  "status",
  "attempts",
  "next_attempt_at",
  "lease_token",
  "lease_expires_at",
  "last_error_code",
  "last_error_message",
  "enqueued_at",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at"
FROM "common_env_reconcile_jobs";

DROP TABLE "common_env_reconcile_jobs";
ALTER TABLE "__new_common_env_reconcile_jobs" RENAME TO "common_env_reconcile_jobs";

CREATE INDEX "idx_common_env_reconcile_jobs_status_next_attempt"
  ON "common_env_reconcile_jobs"("status", "next_attempt_at");
CREATE INDEX "idx_common_env_reconcile_jobs_account_service_status"
  ON "common_env_reconcile_jobs"("account_id", "service_id", "status");
CREATE INDEX "idx_common_env_reconcile_jobs_account_status"
  ON "common_env_reconcile_jobs"("account_id", "status");

DROP TABLE IF EXISTS "__new_custom_domains";
CREATE TABLE "__new_custom_domains" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "service_id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "verification_token" TEXT NOT NULL,
  "verification_method" TEXT NOT NULL DEFAULT 'cname',
  "cf_custom_hostname_id" TEXT,
  "ssl_status" TEXT DEFAULT 'pending',
  "verified_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "custom_domains_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "__new_custom_domains" (
  "id",
  "service_id",
  "domain",
  "status",
  "verification_token",
  "verification_method",
  "cf_custom_hostname_id",
  "ssl_status",
  "verified_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "worker_id",
  "domain",
  "status",
  "verification_token",
  "verification_method",
  "cf_custom_hostname_id",
  "ssl_status",
  "verified_at",
  "created_at",
  "updated_at"
FROM "custom_domains";

DROP TABLE "custom_domains";
ALTER TABLE "__new_custom_domains" RENAME TO "custom_domains";

CREATE UNIQUE INDEX "custom_domains_domain_key" ON "custom_domains"("domain");
CREATE INDEX "idx_custom_domains_service_id" ON "custom_domains"("service_id");
CREATE INDEX "idx_custom_domains_status" ON "custom_domains"("status");
CREATE INDEX "idx_custom_domains_domain" ON "custom_domains"("domain");

DROP TABLE IF EXISTS "__new_managed_takos_tokens";
CREATE TABLE "__new_managed_takos_tokens" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "env_name" TEXT NOT NULL,
  "subject_account_id" TEXT NOT NULL,
  "subject_mode" TEXT NOT NULL,
  "scopes_json" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "token_encrypted" TEXT NOT NULL,
  "last_used_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "managed_takos_tokens_subject_account_id_fkey"
    FOREIGN KEY ("subject_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "managed_takos_tokens_service_id_account_id_fkey"
    FOREIGN KEY ("service_id", "account_id") REFERENCES "services" ("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "managed_takos_tokens_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "__new_managed_takos_tokens" (
  "id",
  "account_id",
  "service_id",
  "env_name",
  "subject_account_id",
  "subject_mode",
  "scopes_json",
  "token_hash",
  "token_prefix",
  "token_encrypted",
  "last_used_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "account_id",
  "worker_id",
  "env_name",
  "subject_account_id",
  "subject_mode",
  "scopes_json",
  "token_hash",
  "token_prefix",
  "token_encrypted",
  "last_used_at",
  "created_at",
  "updated_at"
FROM "managed_takos_tokens";

DROP TABLE "managed_takos_tokens";
ALTER TABLE "__new_managed_takos_tokens" RENAME TO "managed_takos_tokens";

CREATE UNIQUE INDEX "managed_takos_tokens_token_hash_key" ON "managed_takos_tokens"("token_hash");
CREATE INDEX "idx_managed_takos_tokens_service_id" ON "managed_takos_tokens"("service_id");
CREATE INDEX "idx_managed_takos_tokens_subject_account_id" ON "managed_takos_tokens"("subject_account_id");
CREATE INDEX "idx_managed_takos_tokens_account_env" ON "managed_takos_tokens"("account_id", "env_name");
CREATE UNIQUE INDEX "idx_managed_takos_tokens_service_env" ON "managed_takos_tokens"("service_id", "env_name");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
