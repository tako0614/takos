-- Add workload_kind to services (NULL until first deploy, then locked)
ALTER TABLE "services" ADD COLUMN "workload_kind" TEXT DEFAULT NULL;

-- Add artifact_kind to deployments (non-null, existing rows default to worker-bundle)
ALTER TABLE "deployments" ADD COLUMN "artifact_kind" TEXT NOT NULL DEFAULT 'worker-bundle';

-- Backfill: services with an active deployment are worker-bundle
UPDATE "services" SET "workload_kind" = 'worker-bundle'
  WHERE "active_deployment_id" IS NOT NULL AND "workload_kind" IS NULL;
