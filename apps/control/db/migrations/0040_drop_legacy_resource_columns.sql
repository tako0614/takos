UPDATE resources
SET backing_resource_id = COALESCE(backing_resource_id, cf_id)
WHERE backing_resource_id IS NULL;

UPDATE resources
SET backing_resource_name = COALESCE(backing_resource_name, cf_name)
WHERE backing_resource_name IS NULL;

DROP INDEX IF EXISTS idx_resources_cf_id;
DROP INDEX IF EXISTS resources_cf_id_idx;

ALTER TABLE resources DROP COLUMN cf_id;
ALTER TABLE resources DROP COLUMN cf_name;
