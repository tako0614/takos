-- takos-migration-safety: contract
-- takos-migration-approval: ARCHITECTURE-IMPROVEMENTS-v3 [9]; the space-scoped GitService snapshot API (/api/spaces/:spaceId/git/*) is retired in favor of the content-addressed /api/repos/:repoId/* git path, so these D1 tables have no remaining reader or writer.
-- takos-migration-rollback: restore git_commits and git_file_changes from backup, then add a forward compatibility migration before rolling application code back to a version that mounts the legacy GitService route.

DROP TABLE IF EXISTS git_file_changes;
DROP TABLE IF EXISTS git_commits;
