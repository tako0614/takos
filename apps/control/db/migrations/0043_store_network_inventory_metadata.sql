-- Store Network inventory metadata for public REST API responses.
--
-- `repo_actor_url` is kept as the existing storage key for repository URL
-- compatibility. New nullable columns carry Store Network metadata when a
-- remote entry provides it.

ALTER TABLE store_inventory_items ADD COLUMN repo_clone_url TEXT;
ALTER TABLE store_inventory_items ADD COLUMN repo_browse_url TEXT;
ALTER TABLE store_inventory_items ADD COLUMN repo_default_branch TEXT;
ALTER TABLE store_inventory_items ADD COLUMN repo_default_branch_hash TEXT;
