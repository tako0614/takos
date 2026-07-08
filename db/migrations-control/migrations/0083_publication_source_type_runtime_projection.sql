-- takos-migration-safety: backfill
UPDATE publications
SET source_type = 'runtime_projection'
WHERE source_type = 'manifest';
