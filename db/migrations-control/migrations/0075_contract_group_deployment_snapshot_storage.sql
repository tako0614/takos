-- takos-migration-safety: contract
-- takos-migration-approval: ROADMAP 2026-05-13 pre-GA no-user clean cut
-- takos-migration-rollback: restore the database backup taken before this migration

DROP TABLE IF EXISTS group_deployment_snapshots;
ALTER TABLE groups DROP COLUMN current_group_deployment_snapshot_id;
