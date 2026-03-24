DROP INDEX IF EXISTS "idx_deployments_worker_version";
DROP INDEX IF EXISTS "idx_deployments_worker_routing_status";
DROP INDEX IF EXISTS "idx_deployments_worker_id";
DROP INDEX IF EXISTS "idx_deployments_worker_created_at";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_deployments_service_version" ON "deployments"("service_id", "version");
CREATE INDEX IF NOT EXISTS "idx_deployments_service_routing_status" ON "deployments"("service_id", "routing_status");
CREATE INDEX IF NOT EXISTS "idx_deployments_service_id" ON "deployments"("service_id");
CREATE INDEX IF NOT EXISTS "idx_deployments_service_created_at" ON "deployments"("service_id", "created_at");
