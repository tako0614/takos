ALTER TABLE resources ADD COLUMN semantic_type text;
ALTER TABLE resources ADD COLUMN driver text;
ALTER TABLE resources ADD COLUMN backend_name text;
ALTER TABLE resources ADD COLUMN backing_resource_id text;
ALTER TABLE resources ADD COLUMN backing_resource_name text;

UPDATE resources
SET semantic_type = CASE
  WHEN type IN ('sql', 'd1') THEN 'sql'
  WHEN type IN ('object_store', 'r2') THEN 'object_store'
  WHEN type = 'kv' THEN 'kv'
  WHEN type = 'queue' THEN 'queue'
  WHEN type IN ('vector_index', 'vectorize') THEN 'vector_index'
  WHEN type IN ('analytics_store', 'analyticsEngine', 'analytics_engine') THEN 'analytics_store'
  WHEN type IN ('secret', 'secretRef', 'secret_ref') THEN 'secret'
  WHEN type IN ('workflow_runtime', 'workflow', 'workflow_binding') THEN 'workflow_runtime'
  WHEN type IN ('durable_namespace', 'durableObject', 'durable_object', 'durable_object_namespace') THEN 'durable_namespace'
  ELSE semantic_type
END
WHERE semantic_type IS NULL;

UPDATE resources
SET driver = CASE
  WHEN semantic_type = 'sql' THEN 'cloudflare-d1'
  WHEN semantic_type = 'object_store' THEN 'cloudflare-r2'
  WHEN semantic_type = 'kv' THEN 'cloudflare-kv'
  WHEN semantic_type = 'queue' THEN 'cloudflare-queue'
  WHEN semantic_type = 'vector_index' THEN 'cloudflare-vectorize'
  WHEN semantic_type = 'analytics_store' THEN 'cloudflare-analytics-engine'
  WHEN semantic_type = 'secret' THEN 'cloudflare-secret-ref'
  WHEN semantic_type = 'workflow_runtime' THEN 'cloudflare-workflow-binding'
  WHEN semantic_type = 'durable_namespace' THEN 'cloudflare-durable-object-namespace'
  ELSE driver
END
WHERE driver IS NULL;

UPDATE resources
SET backend_name = COALESCE(backend_name, 'cloudflare')
WHERE backend_name IS NULL;

UPDATE resources
SET backing_resource_id = COALESCE(backing_resource_id, cf_id)
WHERE backing_resource_id IS NULL;

UPDATE resources
SET backing_resource_name = COALESCE(backing_resource_name, cf_name)
WHERE backing_resource_name IS NULL;

CREATE INDEX idx_resources_semantic_type ON resources(semantic_type);
CREATE INDEX idx_resources_backend_name ON resources(backend_name);
CREATE INDEX idx_resources_backing_resource_id ON resources(backing_resource_id);
