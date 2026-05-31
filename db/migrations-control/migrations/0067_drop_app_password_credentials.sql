-- takos-migration-safety: contract
-- takos-migration-approval: Local username/password login moved out of Takos app; Takos now consumes Takosumi Accounts OIDC sessions only.
-- takos-migration-rollback: restore account_password_credentials from backup and reintroduce a compatibility password-login route before rolling application code back.

DROP TABLE IF EXISTS account_password_credentials;
