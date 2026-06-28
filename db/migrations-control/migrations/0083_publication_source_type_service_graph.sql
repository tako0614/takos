-- takos-migration-safety: backfill
UPDATE publications
SET source_type = 'service_graph'
WHERE source_type = 'manifest';
