-- takos-migration-safety: expand
-- takos-migration-approval: Adds a nullable queue-delivery ownership token so concurrent duplicate index messages cannot execute the same job simultaneously. Existing rows remain readable and writable.
-- takos-migration-rollback: Roll application code back while retaining the nullable column; Takos app migrations are forward-only and older readers ignore it.

ALTER TABLE "index_jobs" ADD COLUMN "claim_token" TEXT;
