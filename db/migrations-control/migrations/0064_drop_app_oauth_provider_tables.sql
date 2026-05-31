-- takos-migration-safety: contract
-- takos-migration-approval: Takos OAuth/OIDC provider ownership moved to Takosumi Accounts; Takos app no longer reads or writes these tables.
-- takos-migration-rollback: restore affected tables from backup, then add a forward compatibility migration before rolling application code back.

DROP TABLE IF EXISTS oauth_tokens;
DROP TABLE IF EXISTS oauth_device_codes;
DROP TABLE IF EXISTS oauth_authorization_codes;
DROP TABLE IF EXISTS oauth_consents;
DROP TABLE IF EXISTS oauth_audit_logs;
DROP TABLE IF EXISTS oauth_clients;
DROP TABLE IF EXISTS oauth_states;
