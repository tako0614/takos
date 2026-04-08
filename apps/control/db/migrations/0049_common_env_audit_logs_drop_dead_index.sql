-- Round 11 audit Finding #8: drop dead index left behind by migration 0020.
--
-- Migration 0020_service_adjacent_service_id_columns.sql renamed
-- common_env_audit_logs.worker_id -> service_id and issued a
-- `DROP INDEX IF EXISTS idx_common_env_audit_logs_worker_created_at` — but the
-- index actually created by 0001_baseline.sql is named
-- `common_env_audit_logs_worker_id_created_at_idx` (legacy suffix shape).
-- Because the names did not match, the baseline index was never dropped and
-- is still present in every environment. SQLite's automatic ALTER-rewrite
-- on RENAME COLUMN silently updated the index's column reference from
-- `worker_id` to `service_id`, so the index is functionally duplicated with
-- `idx_common_env_audit_logs_service_created_at` (created in 0020) and only
-- occupies storage + write amplification.
--
-- Drop it here so it stops shadowing the canonical index.

DROP INDEX IF EXISTS "common_env_audit_logs_worker_id_created_at_idx";
