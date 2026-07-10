-- takos-migration-safety: expand
-- takos-migration-approval: Adds nullable columns for Workspace-scoped Takosumi Accounts OAuth delegation. Existing identities remain valid for login and must reauthorize before using delegated Capsule operations.
-- takos-migration-rollback: Roll application code back while retaining the nullable columns; Takos app migrations are forward-only and old readers ignore them.

ALTER TABLE auth_identities ADD COLUMN access_token_enc TEXT;
ALTER TABLE auth_identities ADD COLUMN access_token_expires_at TEXT;
ALTER TABLE auth_identities ADD COLUMN token_scope TEXT;
ALTER TABLE auth_identities ADD COLUMN delegated_workspace_id TEXT;
ALTER TABLE auth_identities ADD COLUMN refresh_lease_id TEXT;
ALTER TABLE auth_identities ADD COLUMN refresh_lease_expires_at TEXT;
