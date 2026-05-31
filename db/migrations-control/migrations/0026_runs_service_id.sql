ALTER TABLE "runs" RENAME COLUMN "worker_id" TO "service_id";
DROP INDEX IF EXISTS "idx_runs_worker_id";
CREATE INDEX IF NOT EXISTS "idx_runs_service_id" ON "runs" ("service_id");
