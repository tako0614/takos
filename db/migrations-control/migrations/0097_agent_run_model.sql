-- takos-migration-safety: expand
-- takos-migration-approval: Persists the already-resolved provider model on each new agent Run so stale queue recovery cannot silently switch model, audit, or billing identity.
-- takos-migration-rollback: Roll application code back while retaining the nullable column; older Takos versions ignore it and legacy rows remain recoverable through the Workspace-default fallback.

ALTER TABLE "runs" ADD COLUMN "model" TEXT;
