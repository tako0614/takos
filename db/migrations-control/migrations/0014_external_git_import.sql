-- External Git Import support
-- Extends repo_remotes to track external git URLs and fetch timestamps.

ALTER TABLE repo_remotes ADD COLUMN url TEXT;
ALTER TABLE repo_remotes ADD COLUMN last_fetched_at TEXT;
