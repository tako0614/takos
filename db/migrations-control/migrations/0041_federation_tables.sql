-- Federation tables for ActivityPub Store
-- repo_push_activities, repo_grants

CREATE TABLE repo_push_activities (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  before_sha TEXT,
  after_sha TEXT NOT NULL,
  pusher_actor_url TEXT,
  pusher_name TEXT,
  commit_count INTEGER NOT NULL DEFAULT 0,
  commits_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_push_activities_repo ON repo_push_activities (repo_id);
CREATE INDEX idx_push_activities_account ON repo_push_activities (account_id);
CREATE INDEX idx_push_activities_created ON repo_push_activities (repo_id, created_at);

CREATE TABLE repo_grants (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  grantee_actor_url TEXT NOT NULL,
  capability TEXT NOT NULL,
  granted_by TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_repo_grants_repo ON repo_grants (repo_id);
CREATE UNIQUE INDEX idx_repo_grants_unique ON repo_grants (repo_id, grantee_actor_url, capability);
