ALTER TABLE groups ADD COLUMN desired_spec_json TEXT;
ALTER TABLE groups ADD COLUMN observed_state_json TEXT;
ALTER TABLE groups ADD COLUMN provider_state_json TEXT;
ALTER TABLE groups ADD COLUMN reconcile_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE groups ADD COLUMN last_applied_at TEXT;

UPDATE groups
SET desired_spec_json = manifest_json
WHERE desired_spec_json IS NULL
  AND manifest_json IS NOT NULL;

UPDATE groups
SET provider_state_json = '{}'
WHERE provider_state_json IS NULL;

ALTER TABLE services ADD COLUMN group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_services_group_id ON services(group_id);

ALTER TABLE resources ADD COLUMN group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_resources_group_id ON resources(group_id);

INSERT OR IGNORE INTO resources (
  id,
  owner_account_id,
  account_id,
  group_id,
  name,
  type,
  status,
  cf_id,
  cf_name,
  config,
  metadata,
  manifest_key,
  created_at,
  updated_at
)
SELECT
  ge.id,
  g.space_id,
  g.space_id,
  ge.group_id,
  ge.name,
  COALESCE(json_extract(ge.config, '$.type'), 'kv'),
  'active',
  json_extract(ge.config, '$.cfResourceId'),
  json_extract(ge.config, '$.cfName'),
  ge.config,
  '{}',
  ge.name,
  ge.created_at,
  ge.updated_at
FROM group_entities ge
JOIN groups g ON g.id = ge.group_id
WHERE ge.category = 'resource';

INSERT OR IGNORE INTO services (
  id,
  account_id,
  group_id,
  service_type,
  status,
  config,
  hostname,
  route_ref,
  slug,
  workload_kind,
  created_at,
  updated_at
)
SELECT
  ge.id,
  g.space_id,
  ge.group_id,
  CASE WHEN ge.category = 'worker' THEN 'app' ELSE 'service' END,
  'deployed',
  json_object(
    'managedBy', 'group',
    'manifestName', ge.name,
    'componentKind', ge.category,
    'specFingerprint', '',
    'deployedAt', json_extract(ge.config, '$.deployedAt'),
    'codeHash', json_extract(ge.config, '$.codeHash'),
    'imageHash', json_extract(ge.config, '$.imageHash'),
    'imageRef', json_extract(ge.config, '$.imageRef'),
    'port', json_extract(ge.config, '$.port'),
    'ipv4', json_extract(ge.config, '$.ipv4'),
    'dispatchNamespace', json_extract(ge.config, '$.dispatchNamespace'),
    'legacyConfig', json(ge.config)
  ),
  NULL,
  CASE WHEN ge.category = 'worker' THEN json_extract(ge.config, '$.scriptName') ELSE NULL END,
  printf('grp-%s-%s-%s', substr(ge.group_id, 1, 8), ge.category, replace(lower(ge.name), ' ', '-')),
  CASE WHEN ge.category = 'worker' THEN 'worker-bundle' ELSE 'container-image' END,
  ge.created_at,
  ge.updated_at
FROM group_entities ge
JOIN groups g ON g.id = ge.group_id
WHERE ge.category IN ('worker', 'container', 'service');

DROP TABLE IF EXISTS group_entities;
