ALTER TABLE groups ADD COLUMN source_kind TEXT;
ALTER TABLE groups ADD COLUMN source_repository_url TEXT;
ALTER TABLE groups ADD COLUMN source_ref TEXT;
ALTER TABLE groups ADD COLUMN source_ref_type TEXT;
ALTER TABLE groups ADD COLUMN source_commit_sha TEXT;
ALTER TABLE groups ADD COLUMN current_app_deployment_id TEXT;

ALTER TABLE app_deployments ADD COLUMN group_name_snapshot TEXT;
ALTER TABLE app_deployments ADD COLUMN source_repository_url TEXT;
ALTER TABLE app_deployments ADD COLUMN source_resolved_repo_id TEXT;
ALTER TABLE app_deployments ADD COLUMN snapshot_r2_key TEXT;
ALTER TABLE app_deployments ADD COLUMN snapshot_sha256 TEXT;
ALTER TABLE app_deployments ADD COLUMN snapshot_size_bytes INTEGER;
ALTER TABLE app_deployments ADD COLUMN snapshot_format TEXT;

CREATE INDEX IF NOT EXISTS idx_app_deployments_source_repository_url
  ON app_deployments (source_repository_url);

CREATE INDEX IF NOT EXISTS idx_app_deployments_snapshot_r2_key
  ON app_deployments (snapshot_r2_key);
