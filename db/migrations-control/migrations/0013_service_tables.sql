CREATE TABLE IF NOT EXISTS "services" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "worker_type" TEXT NOT NULL DEFAULT 'app',
  "name_type" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "config" TEXT,
  "hostname" TEXT,
  "route_ref" TEXT,
  "slug" TEXT,
  "active_deployment_id" TEXT,
  "fallback_deployment_id" TEXT,
  "current_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "services_active_deployment_id_fkey" FOREIGN KEY ("active_deployment_id") REFERENCES "deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "services_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "services_hostname_key" ON "services"("hostname");
CREATE UNIQUE INDEX IF NOT EXISTS "services_route_ref_key" ON "services"("route_ref");
CREATE UNIQUE INDEX IF NOT EXISTS "services_slug_key" ON "services"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_services_id_account" ON "services"("id", "account_id");
CREATE INDEX IF NOT EXISTS "idx_services_status" ON "services"("status");
CREATE INDEX IF NOT EXISTS "idx_services_hostname" ON "services"("hostname");
CREATE INDEX IF NOT EXISTS "idx_services_account_status" ON "services"("account_id", "status");
CREATE INDEX IF NOT EXISTS "idx_services_account_id" ON "services"("account_id");

CREATE TABLE IF NOT EXISTS "service_bindings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "service_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "binding_name" TEXT NOT NULL,
  "binding_type" TEXT NOT NULL,
  "config" TEXT NOT NULL DEFAULT '{}',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_bindings_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_bindings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_bindings_service_binding" ON "service_bindings"("service_id", "binding_name");
CREATE INDEX IF NOT EXISTS "idx_service_bindings_service_id" ON "service_bindings"("service_id");
CREATE INDEX IF NOT EXISTS "idx_service_bindings_resource_id" ON "service_bindings"("resource_id");

CREATE TABLE IF NOT EXISTS "service_common_env_links" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "env_name" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "last_applied_fingerprint" TEXT,
  "sync_state" TEXT NOT NULL DEFAULT 'pending',
  "sync_reason" TEXT,
  "last_observed_fingerprint" TEXT,
  "last_reconciled_at" DATETIME,
  "last_sync_error" TEXT,
  "state_updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_common_env_links_service_id_account_id_fkey" FOREIGN KEY ("service_id", "account_id") REFERENCES "services" ("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_common_env_links_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_common_env_links_service_env_source" ON "service_common_env_links"("service_id", "env_name", "source");
CREATE INDEX IF NOT EXISTS "idx_service_common_env_links_service_id" ON "service_common_env_links"("service_id");
CREATE INDEX IF NOT EXISTS "idx_service_common_env_links_sync_state" ON "service_common_env_links"("sync_state");
CREATE INDEX IF NOT EXISTS "idx_service_common_env_links_account_id" ON "service_common_env_links"("account_id");
CREATE INDEX IF NOT EXISTS "idx_service_common_env_links_account_env" ON "service_common_env_links"("account_id", "env_name");

INSERT INTO "services" (
  "id",
  "account_id",
  "worker_type",
  "name_type",
  "status",
  "config",
  "hostname",
  "route_ref",
  "slug",
  "active_deployment_id",
  "fallback_deployment_id",
  "current_version",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "account_id",
  "worker_type",
  "name_type",
  "status",
  "config",
  "hostname",
  "worker_name",
  "slug",
  "current_deployment_id",
  "previous_deployment_id",
  "current_version",
  "created_at",
  "updated_at"
FROM "workers"
WHERE NOT EXISTS (
  SELECT 1 FROM "services" WHERE "services"."id" = "workers"."id"
);

INSERT INTO "service_bindings" (
  "id",
  "service_id",
  "resource_id",
  "binding_name",
  "binding_type",
  "config",
  "created_at"
)
SELECT
  "id",
  "worker_id",
  "resource_id",
  "binding_name",
  "binding_type",
  "config",
  "created_at"
FROM "worker_bindings"
WHERE NOT EXISTS (
  SELECT 1 FROM "service_bindings" WHERE "service_bindings"."id" = "worker_bindings"."id"
);

INSERT INTO "service_common_env_links" (
  "id",
  "account_id",
  "service_id",
  "env_name",
  "source",
  "last_applied_fingerprint",
  "sync_state",
  "sync_reason",
  "last_observed_fingerprint",
  "last_reconciled_at",
  "last_sync_error",
  "state_updated_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "account_id",
  "worker_id",
  "env_name",
  "source",
  "last_applied_fingerprint",
  "sync_state",
  "sync_reason",
  "last_observed_fingerprint",
  "last_reconciled_at",
  "last_sync_error",
  "state_updated_at",
  "created_at",
  "updated_at"
FROM "worker_common_env_links"
WHERE NOT EXISTS (
  SELECT 1 FROM "service_common_env_links" WHERE "service_common_env_links"."id" = "worker_common_env_links"."id"
);
