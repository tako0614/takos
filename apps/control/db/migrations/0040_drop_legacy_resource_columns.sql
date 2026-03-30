UPDATE resources
SET provider_resource_id = COALESCE(provider_resource_id, cf_id)
WHERE provider_resource_id IS NULL;

UPDATE resources
SET provider_resource_name = COALESCE(provider_resource_name, cf_name)
WHERE provider_resource_name IS NULL;

DROP INDEX IF EXISTS idx_resources_cf_id;
DROP INDEX IF EXISTS resources_cf_id_idx;

ALTER TABLE resources DROP COLUMN cf_id;
ALTER TABLE resources DROP COLUMN cf_name;
