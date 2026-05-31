-- Add indexes for chain-walk foreign keys that are filtered without an index.
-- takos-migration-safety: expand
--
-- Wave 21c review surfaced three "superseded by" / "replaced by" columns that
-- are written by rotation / replacement flows and read by chain-walk queries
-- (e.g. "find the row that supersedes X" or "follow the supersession chain").
-- All three columns are nullable and have no index, so chain walks degrade to
-- full table scans as the rotation history grows. The indexes here are
-- additive, do not change any column shape, and can be created before the
-- code that uses them is deployed.
--
--   * memory_claims.superseded_by           — supersession chain in the
--     memory activation graph (claim-store.ts UPDATE/SELECT).
--   * secret_versions.superseded_by_version_id — secret rotation lineage
--     (secret-rotation.ts).
--   * bundle_deployment_events.replaced_bundle_deployment_id — bundle
--     replacement history walked by deploy auditing.
--
-- Columns not addressed by this migration (messages.tool_call_id,
-- accounts.head_snapshot_id, workflow_runs.sha / .ref,
-- repo_remotes.upstream_repo_id) are either never used as a WHERE / JOIN key
-- in current code or are already covered by an existing composite index.

CREATE INDEX IF NOT EXISTS idx_memory_claims_superseded_by
  ON memory_claims (superseded_by);

CREATE INDEX IF NOT EXISTS idx_secret_versions_superseded_by_version_id
  ON secret_versions (superseded_by_version_id);

CREATE INDEX IF NOT EXISTS idx_bundle_deployment_events_replaced_bundle_deployment_id
  ON bundle_deployment_events (replaced_bundle_deployment_id);
