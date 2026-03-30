UPDATE resources
SET
  type = 'sql',
  config = json_set(CASE WHEN json_valid(config) THEN config ELSE '{}' END, '$.resourceCapability', 'sql', '$.implementation', 'd1')
WHERE type = 'd1';

UPDATE resources
SET
  type = 'object_store',
  config = json_set(CASE WHEN json_valid(config) THEN config ELSE '{}' END, '$.resourceCapability', 'object_store', '$.implementation', 'r2')
WHERE type = 'r2';

UPDATE resources
SET
  config = json_set(CASE WHEN json_valid(config) THEN config ELSE '{}' END, '$.resourceCapability', 'kv', '$.implementation', 'kv')
WHERE type = 'kv';

UPDATE resources
SET
  config = json_set(CASE WHEN json_valid(config) THEN config ELSE '{}' END, '$.resourceCapability', 'queue', '$.implementation', 'queue')
WHERE type = 'queue';

UPDATE resources
SET
  type = 'vector_index',
  config = json_set(CASE WHEN json_valid(config) THEN config ELSE '{}' END, '$.resourceCapability', 'vector_index', '$.implementation', 'vectorize')
WHERE type = 'vectorize';

UPDATE resources
SET
  type = 'analytics_store',
  config = json_set(CASE WHEN json_valid(config) THEN config ELSE '{}' END, '$.resourceCapability', 'analytics_store', '$.implementation', 'analytics_engine')
WHERE type IN ('analyticsEngine', 'analytics_engine');

UPDATE resources
SET
  type = 'secret',
  config = json_set(CASE WHEN json_valid(config) THEN config ELSE '{}' END, '$.resourceCapability', 'secret', '$.implementation', 'secret_ref')
WHERE type IN ('secretRef', 'secret_ref');

UPDATE resources
SET
  type = 'workflow_runtime',
  config = json_set(CASE WHEN json_valid(config) THEN config ELSE '{}' END, '$.resourceCapability', 'workflow_runtime', '$.implementation', 'workflow_binding')
WHERE type IN ('workflow', 'workflow_binding');

UPDATE resources
SET
  type = 'durable_namespace',
  config = json_set(CASE WHEN json_valid(config) THEN config ELSE '{}' END, '$.resourceCapability', 'durable_namespace', '$.implementation', 'durable_object_namespace')
WHERE type IN ('durableObject', 'durable_object', 'durable_object_namespace');

UPDATE service_bindings SET binding_type = 'sql' WHERE binding_type = 'd1';
UPDATE service_bindings SET binding_type = 'object_store' WHERE binding_type IN ('r2', 'r2_bucket');
UPDATE service_bindings SET binding_type = 'vector_index' WHERE binding_type = 'vectorize';
UPDATE service_bindings SET binding_type = 'analytics_store' WHERE binding_type IN ('analyticsEngine', 'analytics_engine');
UPDATE service_bindings SET binding_type = 'workflow_runtime' WHERE binding_type = 'workflow';
UPDATE service_bindings SET binding_type = 'durable_namespace' WHERE binding_type = 'durable_object_namespace';
