-- Retire workflow-run provenance fields from build_sources_json.
-- The current build source shape is { service_name, artifact_path }.
UPDATE group_deployment_snapshots
SET build_sources_json = (
  SELECT COALESCE(
    json_group_array(
      json_object(
        'service_name',
        json_extract(value, '$.service_name'),
        'artifact_path',
        json_extract(value, '$.artifact_path')
      )
    ),
    '[]'
  )
  FROM json_each(group_deployment_snapshots.build_sources_json)
  WHERE json_extract(value, '$.service_name') IS NOT NULL
    AND json_extract(value, '$.artifact_path') IS NOT NULL
)
WHERE build_sources_json IS NOT NULL
  AND json_valid(build_sources_json);
