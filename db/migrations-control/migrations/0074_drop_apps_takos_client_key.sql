-- takos-migration-safety: contract
-- takos-migration-approval: App-local app client keys are retired; current runtime credentials are materialized by Takosumi Accounts ServiceBinding/ServiceGrant records.
-- takos-migration-rollback: restore apps.takos_client_key from backup and roll forward to a version that reintroduces app-local client key issuance before accepting those credentials again.

ALTER TABLE "apps" DROP COLUMN "takos_client_key";
