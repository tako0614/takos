PRAGMA foreign_keys=OFF;

DROP TRIGGER IF EXISTS "trg_services_mirror_insert_to_workers";
DROP TRIGGER IF EXISTS "trg_services_mirror_update_to_workers";
DROP TRIGGER IF EXISTS "trg_services_mirror_delete_to_workers";

ALTER TABLE "workers" RENAME TO "workers__old_deployments_fk_repair";

CREATE TABLE "workers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "worker_type" TEXT NOT NULL DEFAULT 'app',
    "name_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "config" TEXT,
    "hostname" TEXT,
    "worker_name" TEXT,
    "slug" TEXT,
    "current_deployment_id" TEXT,
    "previous_deployment_id" TEXT,
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workers_current_deployment_id_fkey" FOREIGN KEY ("current_deployment_id") REFERENCES "deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
FROM "workers__old_deployments_fk_repair";

DROP TABLE "workers__old_deployments_fk_repair";

CREATE UNIQUE INDEX "workers_hostname_key" ON "workers"("hostname");
CREATE UNIQUE INDEX "workers_worker_name_key" ON "workers"("worker_name");
CREATE UNIQUE INDEX "workers_slug_key" ON "workers"("slug");
CREATE INDEX "workers_status_idx" ON "workers"("status");
CREATE INDEX "workers_hostname_idx" ON "workers"("hostname");
CREATE INDEX "workers_account_id_status_idx" ON "workers"("account_id", "status");
CREATE INDEX "workers_account_id_idx" ON "workers"("account_id");
CREATE UNIQUE INDEX "workers_id_account_id_key" ON "workers"("id", "account_id");

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

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
