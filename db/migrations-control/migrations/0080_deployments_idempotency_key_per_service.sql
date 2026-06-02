-- 0080_deployments_idempotency_key_per_service
-- takos-migration-safety: expand
--
-- deployments.idempotency_key was globally unique
-- ("deployments_idempotency_key_key", created in 0001_baseline.sql and rebuilt
-- in 0015_deployments_service_id.sql). idempotency keys are client-chosen and
-- scoped to a single service, so a global unique let a key value picked by one
-- service collide with -- and block -- an unrelated service's deploy that
-- happened to reuse the same key. This is a cross-tenant deploy block: tenant
-- A's key value can deny tenant B's insert.
--
-- Replace the global unique with a composite unique on
-- (service_id, idempotency_key) so a key is only unique within its own service.
-- Matches the schema (schema-workers.ts uniqServiceIdempotencyKey) and the dev
-- bootstrap (local-platform/d1-migrations.ts).
--
-- This is an EXPAND, not a contract: widening a globally-unique column to a
-- composite unique cannot fail on existing data, because every existing row was
-- already globally unique on idempotency_key, so it is trivially unique on the
-- broader (service_id, idempotency_key) tuple too. No backfill or duplicate
-- pre-check is required.
--
-- idempotency_key is nullable; both SQLite and Postgres treat each NULL as
-- distinct in a unique index, so the many rows with NULL keys remain unaffected.
--
-- DROP INDEX is not flagged as dangerous DDL by validate-migration-safety.ts,
-- and the CREATE uses IF NOT EXISTS, so this stays an expand-class migration
-- with no approval/rollback markers required.

DROP INDEX IF EXISTS "deployments_idempotency_key_key";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_deployments_service_idempotency_key"
  ON "deployments"("service_id", "idempotency_key");
