ALTER TABLE resources ADD COLUMN orphaned_at TEXT;
CREATE INDEX IF NOT EXISTS idx_resources_orphaned_at ON resources(orphaned_at);
