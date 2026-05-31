ALTER TABLE "runs" RENAME COLUMN "worker_heartbeat" TO "service_heartbeat";
DROP INDEX IF EXISTS "idx_runs_worker_heartbeat";
CREATE INDEX IF NOT EXISTS "idx_runs_service_heartbeat" ON "runs"("service_heartbeat");
