UPDATE groups
SET desired_spec_json = CASE
  WHEN desired_spec_json IS NOT NULL
    AND json_valid(desired_spec_json)
    AND json_type(desired_spec_json, '$.manifest') IS NOT NULL
    THEN json_extract(desired_spec_json, '$.manifest')
  WHEN desired_spec_json IS NULL AND manifest_json IS NOT NULL
    THEN manifest_json
  ELSE desired_spec_json
END;

ALTER TABLE groups DROP COLUMN manifest_json;
ALTER TABLE groups DROP COLUMN observed_state_json;
