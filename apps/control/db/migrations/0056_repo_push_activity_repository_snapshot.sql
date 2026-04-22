-- Store Network repo feed snapshots for delete events.
--
-- Delete activities outlive the repositories row. These nullable columns keep
-- enough public reference metadata to render repo.delete feed entries after the
-- source repository has been removed.

ALTER TABLE repo_push_activities ADD COLUMN repo_owner_slug TEXT;
ALTER TABLE repo_push_activities ADD COLUMN repo_name TEXT;
ALTER TABLE repo_push_activities ADD COLUMN repo_summary TEXT;
ALTER TABLE repo_push_activities ADD COLUMN repo_visibility TEXT;
ALTER TABLE repo_push_activities ADD COLUMN repo_default_branch TEXT;
ALTER TABLE repo_push_activities ADD COLUMN repo_default_branch_hash TEXT;
ALTER TABLE repo_push_activities ADD COLUMN repo_created_at TEXT;
ALTER TABLE repo_push_activities ADD COLUMN repo_updated_at TEXT;

CREATE INDEX idx_push_activities_account_created
  ON repo_push_activities (account_id, created_at);
