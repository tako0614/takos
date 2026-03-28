ALTER TABLE "infra_workers" RENAME TO "service_runtimes";
DROP INDEX IF EXISTS "infra_workers_bundle_deployment_id_idx";
DROP INDEX IF EXISTS "infra_workers_account_id_idx";
DROP INDEX IF EXISTS "infra_workers_account_id_name_key";
CREATE INDEX "service_runtimes_bundle_deployment_id_idx" ON "service_runtimes"("bundle_deployment_id");
CREATE INDEX "service_runtimes_account_id_idx" ON "service_runtimes"("account_id");
CREATE UNIQUE INDEX "service_runtimes_account_id_name_key" ON "service_runtimes"("account_id", "name");
