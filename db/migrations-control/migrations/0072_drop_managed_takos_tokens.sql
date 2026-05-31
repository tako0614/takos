-- takos-migration-safety: contract
-- takos-migration-approval: App-local managed Takos tokens are retired; runtime issuance, validation, and cleanup no longer depend on managed_takos_tokens.
-- takos-migration-rollback: restore managed_takos_tokens from backup and roll forward to an application version that reintroduces app-local managed token issuance before accepting tak_pat_ credentials again.

DROP TABLE IF EXISTS managed_takos_tokens;
