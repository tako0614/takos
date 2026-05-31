-- takos-migration-safety: contract
-- takos-migration-approval: Resource-scoped bearer credentials moved out of Takos app-local SQL; resource credentials are now represented by AppGrant/AppBinding materialized by Takosumi Accounts.
-- takos-migration-rollback: restore resource_access_tokens from backup and reintroduce the retired resource token endpoints before rolling application code back.

DROP TABLE IF EXISTS resource_access_tokens;
