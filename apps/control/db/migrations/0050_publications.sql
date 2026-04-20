CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  group_id TEXT,
  owner_service_id TEXT REFERENCES services(id),
  source_type TEXT NOT NULL DEFAULT 'api',
  name TEXT NOT NULL,
  catalog_name TEXT,
  publication_type TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  resolved_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_account_name
  ON publications(account_id, name);

CREATE INDEX IF NOT EXISTS idx_publications_account_id
  ON publications(account_id);

CREATE INDEX IF NOT EXISTS idx_publications_group_id
  ON publications(group_id);

CREATE INDEX IF NOT EXISTS idx_publications_owner_service_id
  ON publications(owner_service_id);

CREATE INDEX IF NOT EXISTS idx_publications_account_type
  ON publications(account_id, publication_type);

CREATE TABLE IF NOT EXISTS service_consumes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  publication_name TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_consumes_service_name
  ON service_consumes(service_id, publication_name);

CREATE INDEX IF NOT EXISTS idx_service_consumes_service_id
  ON service_consumes(service_id);

CREATE INDEX IF NOT EXISTS idx_service_consumes_account_id
  ON service_consumes(account_id);

CREATE INDEX IF NOT EXISTS idx_service_consumes_account_publication
  ON service_consumes(account_id, publication_name);
