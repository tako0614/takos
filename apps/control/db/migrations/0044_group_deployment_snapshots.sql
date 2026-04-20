CREATE TABLE IF NOT EXISTS group_deployment_snapshots (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  created_by_account_id TEXT,
  source_kind TEXT NOT NULL,
  source_repo_id TEXT,
  source_owner TEXT,
  source_repo_name TEXT,
  source_version TEXT,
  source_ref TEXT,
  source_ref_type TEXT,
  source_commit_sha TEXT,
  source_release_id TEXT,
  source_tag TEXT,
  status TEXT NOT NULL DEFAULT 'applied',
  manifest_json TEXT NOT NULL,
  build_sources_json TEXT,
  hostnames_json TEXT,
  result_json TEXT,
  rollback_of_group_deployment_snapshot_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_group_deployment_snapshots_space_created
  ON group_deployment_snapshots (space_id, created_at);

CREATE INDEX IF NOT EXISTS idx_group_deployment_snapshots_group_created
  ON group_deployment_snapshots (group_id, created_at);

CREATE INDEX IF NOT EXISTS idx_group_deployment_snapshots_status
  ON group_deployment_snapshots (status);

CREATE INDEX IF NOT EXISTS idx_group_deployment_snapshots_rollback_of
  ON group_deployment_snapshots (rollback_of_group_deployment_snapshot_id);

ALTER TABLE groups ADD COLUMN source_kind TEXT;
ALTER TABLE groups ADD COLUMN source_repository_url TEXT;
ALTER TABLE groups ADD COLUMN source_ref TEXT;
ALTER TABLE groups ADD COLUMN source_ref_type TEXT;
ALTER TABLE groups ADD COLUMN source_commit_sha TEXT;
ALTER TABLE groups ADD COLUMN current_group_deployment_snapshot_id TEXT;

ALTER TABLE group_deployment_snapshots ADD COLUMN group_name_snapshot TEXT;
ALTER TABLE group_deployment_snapshots ADD COLUMN source_repository_url TEXT;
ALTER TABLE group_deployment_snapshots ADD COLUMN source_resolved_repo_id TEXT;
ALTER TABLE group_deployment_snapshots ADD COLUMN snapshot_r2_key TEXT;
ALTER TABLE group_deployment_snapshots ADD COLUMN snapshot_sha256 TEXT;
ALTER TABLE group_deployment_snapshots ADD COLUMN snapshot_size_bytes INTEGER;
ALTER TABLE group_deployment_snapshots ADD COLUMN snapshot_format TEXT;

CREATE INDEX IF NOT EXISTS idx_group_deployment_snapshots_source_repository_url
  ON group_deployment_snapshots (source_repository_url);

CREATE INDEX IF NOT EXISTS idx_group_deployment_snapshots_snapshot_r2_key
  ON group_deployment_snapshots (snapshot_r2_key);
