PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS "apps__old_service_fk_repair";
ALTER TABLE "apps" RENAME TO "apps__old_service_fk_repair";

CREATE TABLE "apps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "service_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "app_type" TEXT NOT NULL,
    "takos_client_key" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "apps_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "apps_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "apps" (
    "id",
    "account_id",
    "service_id",
    "name",
    "description",
    "icon",
    "app_type",
    "takos_client_key",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "account_id",
    "service_id",
    "name",
    "description",
    "icon",
    "app_type",
    "takos_client_key",
    "created_at",
    "updated_at"
FROM "apps__old_service_fk_repair";

DROP TABLE "apps__old_service_fk_repair";

CREATE INDEX IF NOT EXISTS "idx_apps_service_id" ON "apps" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_apps_app_type" ON "apps" ("app_type");
CREATE INDEX IF NOT EXISTS "idx_apps_account_id" ON "apps" ("account_id");

DROP TABLE IF EXISTS "common_env_audit_logs__old_service_fk_repair";
ALTER TABLE "common_env_audit_logs" RENAME TO "common_env_audit_logs__old_service_fk_repair";

CREATE TABLE "common_env_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "actor_account_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "env_name" TEXT NOT NULL,
    "service_id" TEXT,
    "link_source" TEXT,
    "change_before" TEXT NOT NULL DEFAULT '{}',
    "change_after" TEXT NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "common_env_audit_logs_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "common_env_audit_logs_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "common_env_audit_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "common_env_audit_logs" (
    "id",
    "account_id",
    "actor_account_id",
    "actor_type",
    "event_type",
    "env_name",
    "service_id",
    "link_source",
    "change_before",
    "change_after",
    "request_id",
    "ip_hash",
    "user_agent",
    "created_at"
)
SELECT
    "id",
    "account_id",
    "actor_account_id",
    "actor_type",
    "event_type",
    "env_name",
    "service_id",
    "link_source",
    "change_before",
    "change_after",
    "request_id",
    "ip_hash",
    "user_agent",
    "created_at"
FROM "common_env_audit_logs__old_service_fk_repair";

DROP TABLE "common_env_audit_logs__old_service_fk_repair";

CREATE INDEX IF NOT EXISTS "idx_common_env_audit_logs_service_created_at"
  ON "common_env_audit_logs" ("service_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_common_env_audit_logs_account_env_created_at"
  ON "common_env_audit_logs" ("account_id", "env_name", "created_at");
CREATE INDEX IF NOT EXISTS "idx_common_env_audit_logs_account_created_at"
  ON "common_env_audit_logs" ("account_id", "created_at");

DROP TABLE IF EXISTS "mcp_servers__old_service_fk_repair";
ALTER TABLE "mcp_servers" RENAME TO "mcp_servers__old_service_fk_repair";

CREATE TABLE "mcp_servers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'streamable-http',
    "source_type" TEXT NOT NULL DEFAULT 'external',
    "auth_mode" TEXT NOT NULL DEFAULT 'oauth_pkce',
    "service_id" TEXT,
    "bundle_deployment_id" TEXT,
    "oauth_access_token" TEXT,
    "oauth_refresh_token" TEXT,
    "oauth_token_expires_at" DATETIME,
    "oauth_scope" TEXT,
    "oauth_issuer_url" TEXT,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_servers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "mcp_servers" (
    "id",
    "account_id",
    "name",
    "url",
    "transport",
    "source_type",
    "auth_mode",
    "service_id",
    "bundle_deployment_id",
    "oauth_access_token",
    "oauth_refresh_token",
    "oauth_token_expires_at",
    "oauth_scope",
    "oauth_issuer_url",
    "enabled",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "account_id",
    "name",
    "url",
    "transport",
    "source_type",
    "auth_mode",
    "service_id",
    "bundle_deployment_id",
    "oauth_access_token",
    "oauth_refresh_token",
    "oauth_token_expires_at",
    "oauth_scope",
    "oauth_issuer_url",
    "enabled",
    "created_at",
    "updated_at"
FROM "mcp_servers__old_service_fk_repair";

DROP TABLE "mcp_servers__old_service_fk_repair";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mcp_servers_account_name"
  ON "mcp_servers" ("account_id", "name");
CREATE INDEX IF NOT EXISTS "idx_mcp_servers_service_id"
  ON "mcp_servers" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_mcp_servers_bundle_deployment_id"
  ON "mcp_servers" ("bundle_deployment_id");
CREATE INDEX IF NOT EXISTS "idx_mcp_servers_account_id"
  ON "mcp_servers" ("account_id");

DROP TABLE IF EXISTS "service_runtime_settings__old_service_fk_repair";
ALTER TABLE "service_runtime_settings" RENAME TO "service_runtime_settings__old_service_fk_repair";

CREATE TABLE "service_runtime_settings" (
    "service_id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "compatibility_date" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_runtime_settings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "service_runtime_settings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "service_runtime_settings" (
    "service_id",
    "account_id",
    "compatibility_date",
    "created_at",
    "updated_at"
)
SELECT
    "service_id",
    "account_id",
    "compatibility_date",
    "created_at",
    "updated_at"
FROM "service_runtime_settings__old_service_fk_repair";

DROP TABLE "service_runtime_settings__old_service_fk_repair";

CREATE INDEX IF NOT EXISTS "idx_service_runtime_settings_account_id"
  ON "service_runtime_settings" ("account_id");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
