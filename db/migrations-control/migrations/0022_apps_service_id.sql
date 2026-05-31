ALTER TABLE "apps" RENAME COLUMN "worker_id" TO "service_id";
DROP INDEX IF EXISTS "idx_apps_worker_id";
CREATE INDEX "idx_apps_service_id" ON "apps"("service_id");
