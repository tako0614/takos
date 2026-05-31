-- Cross-isolate deploy cancellation flag.
-- takos-migration-safety: expand
--
-- Nullable additive column on `deployments`. The cancel route writes the
-- request timestamp here so a pipeline running in another isolate can pick
-- up the cancellation by polling this column at phase boundaries. Cleared
-- back to NULL when the deployment terminates (success / failed /
-- rolled_back). Treating any non-NULL value as "cancel requested" keeps the
-- read path branchless.

ALTER TABLE deployments ADD COLUMN cancellation_requested_at INTEGER;
