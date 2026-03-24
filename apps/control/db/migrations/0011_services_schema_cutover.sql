CREATE TABLE IF NOT EXISTS "services" (
  "id" TEXT PRIMARY KEY NOT NULL,
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
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "services_hostname_key" ON "services"("hostname");
CREATE UNIQUE INDEX IF NOT EXISTS "services_route_ref_key" ON "services"("route_ref");
CREATE UNIQUE INDEX IF NOT EXISTS "services_slug_key" ON "services"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_services_id_account" ON "services"("id", "account_id");
CREATE INDEX IF NOT EXISTS "idx_services_status" ON "services"("status");
CREATE INDEX IF NOT EXISTS "idx_services_hostname" ON "services"("hostname");
CREATE INDEX IF NOT EXISTS "idx_services_account_status" ON "services"("account_id", "status");
CREATE INDEX IF NOT EXISTS "idx_services_account_id" ON "services"("account_id");

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
  SELECT 1
  FROM "services"
  WHERE "services"."id" = "workers"."id"
);

CREATE TABLE IF NOT EXISTS "service_bindings" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "service_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "binding_name" TEXT NOT NULL,
  "binding_type" TEXT NOT NULL,
  "config" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_bindings_service_binding" ON "service_bindings"("service_id", "binding_name");
CREATE INDEX IF NOT EXISTS "idx_service_bindings_service_id" ON "service_bindings"("service_id");
CREATE INDEX IF NOT EXISTS "idx_service_bindings_resource_id" ON "service_bindings"("resource_id");

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
  SELECT 1
  FROM "service_bindings"
  WHERE "service_bindings"."id" = "worker_bindings"."id"
);

CREATE TABLE IF NOT EXISTS "service_common_env_links" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "account_id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "env_name" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "last_applied_fingerprint" TEXT,
  "sync_state" TEXT NOT NULL DEFAULT 'pending',
  "sync_reason" TEXT,
  "last_observed_fingerprint" TEXT,
  "last_reconciled_at" TEXT,
  "last_sync_error" TEXT,
  "state_updated_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_common_env_links_service_env_source" ON "service_common_env_links"("service_id", "env_name", "source");
CREATE INDEX IF NOT EXISTS "idx_service_common_env_links_service_id" ON "service_common_env_links"("service_id");
CREATE INDEX IF NOT EXISTS "idx_service_common_env_links_sync_state" ON "service_common_env_links"("sync_state");
CREATE INDEX IF NOT EXISTS "idx_service_common_env_links_account_id" ON "service_common_env_links"("account_id");
CREATE INDEX IF NOT EXISTS "idx_service_common_env_links_account_env" ON "service_common_env_links"("account_id", "env_name");

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
  SELECT 1
  FROM "service_common_env_links"
  WHERE "service_common_env_links"."id" = "worker_common_env_links"."id"
);

CREATE TRIGGER IF NOT EXISTS "trg_services_mirror_insert_to_workers"
AFTER INSERT ON "services"
BEGIN
  INSERT INTO "workers" (
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
  ) VALUES (
    NEW."id",
    NEW."account_id",
    NEW."worker_type",
    NEW."name_type",
    NEW."status",
    NEW."config",
    NEW."hostname",
    NEW."route_ref",
    NEW."slug",
    NEW."active_deployment_id",
    NEW."fallback_deployment_id",
    NEW."current_version",
    NEW."created_at",
    NEW."updated_at"
  )
  ON CONFLICT("id") DO UPDATE SET
    "account_id" = excluded."account_id",
    "worker_type" = excluded."worker_type",
    "name_type" = excluded."name_type",
    "status" = excluded."status",
    "config" = excluded."config",
    "hostname" = excluded."hostname",
    "worker_name" = excluded."worker_name",
    "slug" = excluded."slug",
    "current_deployment_id" = excluded."current_deployment_id",
    "previous_deployment_id" = excluded."previous_deployment_id",
    "current_version" = excluded."current_version",
    "created_at" = excluded."created_at",
    "updated_at" = excluded."updated_at";
END;

CREATE TRIGGER IF NOT EXISTS "trg_services_mirror_update_to_workers"
AFTER UPDATE ON "services"
BEGIN
  INSERT INTO "workers" (
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
  ) VALUES (
    NEW."id",
    NEW."account_id",
    NEW."worker_type",
    NEW."name_type",
    NEW."status",
    NEW."config",
    NEW."hostname",
    NEW."route_ref",
    NEW."slug",
    NEW."active_deployment_id",
    NEW."fallback_deployment_id",
    NEW."current_version",
    NEW."created_at",
    NEW."updated_at"
  )
  ON CONFLICT("id") DO UPDATE SET
    "account_id" = excluded."account_id",
    "worker_type" = excluded."worker_type",
    "name_type" = excluded."name_type",
    "status" = excluded."status",
    "config" = excluded."config",
    "hostname" = excluded."hostname",
    "worker_name" = excluded."worker_name",
    "slug" = excluded."slug",
    "current_deployment_id" = excluded."current_deployment_id",
    "previous_deployment_id" = excluded."previous_deployment_id",
    "current_version" = excluded."current_version",
    "created_at" = excluded."created_at",
    "updated_at" = excluded."updated_at";
END;

CREATE TRIGGER IF NOT EXISTS "trg_services_mirror_delete_to_workers"
AFTER DELETE ON "services"
BEGIN
  DELETE FROM "workers" WHERE "id" = OLD."id";
END;

CREATE TRIGGER IF NOT EXISTS "trg_service_bindings_mirror_insert_to_worker_bindings"
AFTER INSERT ON "service_bindings"
BEGIN
  INSERT INTO "worker_bindings" (
    "id",
    "worker_id",
    "resource_id",
    "binding_name",
    "binding_type",
    "config",
    "created_at"
  ) VALUES (
    NEW."id",
    NEW."service_id",
    NEW."resource_id",
    NEW."binding_name",
    NEW."binding_type",
    NEW."config",
    NEW."created_at"
  )
  ON CONFLICT("id") DO UPDATE SET
    "worker_id" = excluded."worker_id",
    "resource_id" = excluded."resource_id",
    "binding_name" = excluded."binding_name",
    "binding_type" = excluded."binding_type",
    "config" = excluded."config",
    "created_at" = excluded."created_at";
END;

CREATE TRIGGER IF NOT EXISTS "trg_service_bindings_mirror_delete_to_worker_bindings"
AFTER DELETE ON "service_bindings"
BEGIN
  DELETE FROM "worker_bindings" WHERE "id" = OLD."id";
END;

CREATE TRIGGER IF NOT EXISTS "trg_service_common_env_links_mirror_insert_to_worker_links"
AFTER INSERT ON "service_common_env_links"
BEGIN
  INSERT INTO "worker_common_env_links" (
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
  ) VALUES (
    NEW."id",
    NEW."account_id",
    NEW."service_id",
    NEW."env_name",
    NEW."source",
    NEW."last_applied_fingerprint",
    NEW."sync_state",
    NEW."sync_reason",
    NEW."last_observed_fingerprint",
    NEW."last_reconciled_at",
    NEW."last_sync_error",
    NEW."state_updated_at",
    NEW."created_at",
    NEW."updated_at"
  )
  ON CONFLICT("id") DO UPDATE SET
    "account_id" = excluded."account_id",
    "worker_id" = excluded."worker_id",
    "env_name" = excluded."env_name",
    "source" = excluded."source",
    "last_applied_fingerprint" = excluded."last_applied_fingerprint",
    "sync_state" = excluded."sync_state",
    "sync_reason" = excluded."sync_reason",
    "last_observed_fingerprint" = excluded."last_observed_fingerprint",
    "last_reconciled_at" = excluded."last_reconciled_at",
    "last_sync_error" = excluded."last_sync_error",
    "state_updated_at" = excluded."state_updated_at",
    "created_at" = excluded."created_at",
    "updated_at" = excluded."updated_at";
END;

CREATE TRIGGER IF NOT EXISTS "trg_service_common_env_links_mirror_delete_to_worker_links"
AFTER DELETE ON "service_common_env_links"
BEGIN
  DELETE FROM "worker_common_env_links" WHERE "id" = OLD."id";
END;
