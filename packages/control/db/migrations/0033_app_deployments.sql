CREATE TABLE IF NOT EXISTS app_deployments (
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
  rollback_of_app_deployment_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_deployments_space_created
  ON app_deployments (space_id, created_at);

CREATE INDEX IF NOT EXISTS idx_app_deployments_group_created
  ON app_deployments (group_id, created_at);

CREATE INDEX IF NOT EXISTS idx_app_deployments_status
  ON app_deployments (status);

CREATE INDEX IF NOT EXISTS idx_app_deployments_rollback_of
  ON app_deployments (rollback_of_app_deployment_id);
