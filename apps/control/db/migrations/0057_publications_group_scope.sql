DROP INDEX IF EXISTS idx_publications_account_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_account_global_name
  ON publications(account_id, name)
  WHERE group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_account_group_name
  ON publications(account_id, group_id, name)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_publications_account_name
  ON publications(account_id, name);
