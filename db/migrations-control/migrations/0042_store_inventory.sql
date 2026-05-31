-- Store inventory: explicit repo registration + outbox activity log

CREATE TABLE store_inventory_items (
  id TEXT PRIMARY KEY,
  store_slug TEXT NOT NULL,
  account_id TEXT NOT NULL,
  repo_actor_url TEXT NOT NULL,
  repo_name TEXT,
  repo_summary TEXT,
  repo_owner_slug TEXT,
  local_repo_id TEXT,
  activity_type TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_store_inventory_store ON store_inventory_items (account_id, store_slug);
CREATE INDEX idx_store_inventory_active ON store_inventory_items (account_id, store_slug, is_active);
CREATE UNIQUE INDEX idx_store_inventory_unique_active ON store_inventory_items (account_id, store_slug, repo_actor_url) WHERE is_active = 1;
CREATE INDEX idx_store_inventory_created ON store_inventory_items (account_id, store_slug, created_at);
CREATE INDEX idx_store_inventory_local_repo ON store_inventory_items (local_repo_id);
