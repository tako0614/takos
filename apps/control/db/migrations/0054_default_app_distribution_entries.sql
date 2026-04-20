CREATE TABLE IF NOT EXISTS default_app_distribution_config (
  id TEXT PRIMARY KEY,
  configured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS default_app_distribution_entries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  repository_url TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT 'main',
  ref_type TEXT NOT NULL DEFAULT 'branch',
  preinstall INTEGER NOT NULL DEFAULT 1,
  backend_name TEXT,
  env_name TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_default_app_distribution_entries_name
  ON default_app_distribution_entries (name);

CREATE INDEX IF NOT EXISTS idx_default_app_distribution_entries_enabled_position
  ON default_app_distribution_entries (enabled, position);

CREATE TABLE IF NOT EXISTS default_app_preinstall_jobs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  created_by_account_id TEXT,
  distribution_json TEXT,
  expected_group_ids_json TEXT,
  deployment_queued_at TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  locked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_default_app_preinstall_jobs_status_next_attempt
  ON default_app_preinstall_jobs (status, next_attempt_at);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_default_app_preinstall_jobs_space_id
  ON default_app_preinstall_jobs (space_id);
