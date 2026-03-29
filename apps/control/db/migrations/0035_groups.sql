CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  app_version TEXT,
  provider TEXT,
  env TEXT,
  manifest_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_space_name ON groups(space_id, name);

CREATE TABLE IF NOT EXISTS group_entities (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_entities_unique ON group_entities(group_id, category, name);
CREATE INDEX IF NOT EXISTS idx_group_entities_group ON group_entities(group_id);
CREATE INDEX IF NOT EXISTS idx_group_entities_category ON group_entities(group_id, category);
