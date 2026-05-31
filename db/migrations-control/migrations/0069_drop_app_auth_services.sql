-- takos-migration-safety: contract
-- takos-migration-approval: Legacy app-local OAuth provider service registry is retired; Takos app is now an OIDC consumer and Takosumi Accounts owns issuer/client registration.
-- takos-migration-rollback: restore auth_services from backup and reintroduce the retired app-local OAuth provider service registry before rolling application code back.

DROP TABLE IF EXISTS auth_services;
