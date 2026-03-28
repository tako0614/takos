-- Store Registry: tracks remote ActivityPub stores known to this instance
CREATE TABLE IF NOT EXISTS store_registry (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  actor_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  store_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT,
  icon_url TEXT,
  public_key_pem TEXT,
  repositories_url TEXT,
  search_url TEXT,
  outbox_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  subscription_enabled INTEGER NOT NULL DEFAULT 0,
  last_fetched_at TEXT,
  last_outbox_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_store_registry_account_id ON store_registry(account_id);
CREATE UNIQUE INDEX idx_store_registry_account_actor ON store_registry(account_id, actor_url);
CREATE INDEX idx_store_registry_domain ON store_registry(domain);
CREATE INDEX idx_store_registry_subscription ON store_registry(subscription_enabled);

-- Store Registry Updates: cached updates from remote store outbox polling
CREATE TABLE IF NOT EXISTS store_registry_updates (
  id TEXT PRIMARY KEY,
  registry_entry_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  object_type TEXT,
  object_name TEXT,
  object_summary TEXT,
  published TEXT,
  seen INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_store_registry_updates_registry ON store_registry_updates(registry_entry_id);
CREATE INDEX idx_store_registry_updates_account ON store_registry_updates(account_id);
CREATE UNIQUE INDEX idx_store_registry_updates_activity ON store_registry_updates(registry_entry_id, activity_id);
CREATE INDEX idx_store_registry_updates_seen ON store_registry_updates(account_id, seen);

-- Add remote store tracking columns to repositories
ALTER TABLE repositories ADD COLUMN remote_clone_url TEXT;
ALTER TABLE repositories ADD COLUMN remote_store_actor_url TEXT;
