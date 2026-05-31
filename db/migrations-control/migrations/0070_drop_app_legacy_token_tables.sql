-- takos-migration-safety: contract
-- takos-migration-approval: Legacy app-local service/app token registries are unused in the current Takos app; Accounts/AppGrant and scoped Accounts bearer are the credential owner surfaces.
-- takos-migration-rollback: restore service_tokens/app_tokens from backup and reintroduce their issuer/validator paths before rolling application code back.

DROP TABLE IF EXISTS app_tokens;
DROP TABLE IF EXISTS service_tokens;
