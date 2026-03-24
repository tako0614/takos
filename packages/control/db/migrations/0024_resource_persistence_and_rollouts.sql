-- Resource persistence: stable manifest key for cross-deployment resource identity
ALTER TABLE resources ADD COLUMN manifest_key TEXT;
ALTER TABLE resources ADD COLUMN orphaned_at TEXT;
CREATE INDEX idx_resources_manifest_key ON resources(manifest_key);
CREATE INDEX idx_resources_orphaned_at ON resources(orphaned_at);

-- Staged rollout state
ALTER TABLE bundle_deployments ADD COLUMN rollout_state TEXT;
