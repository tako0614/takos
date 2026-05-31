-- takos-migration-safety: contract
-- takos-migration-approval: Legacy personal access tokens moved to Takosumi Accounts; Takos app now consumes Accounts bearer tokens instead of issuing app-local PATs.
-- takos-migration-rollback: restore personal_access_tokens and pat_revoked from backup and reintroduce the app-local PAT issuer/validator before rolling application code back.

DROP TABLE IF EXISTS pat_revoked;
DROP TABLE IF EXISTS personal_access_tokens;
