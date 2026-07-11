-- takos-migration-safety: expand
-- takos-migration-approval: Adds MCP 2025-11-25 authorization discovery, client registration, resource binding, and encrypted client-secret fields without changing existing connections or token ciphertext.
-- takos-migration-rollback: Roll application code back while retaining the nullable columns; older Takos versions ignore them and Takos app migrations are forward-only.

ALTER TABLE "mcp_oauth_pending" ADD COLUMN "authorization_endpoint" TEXT;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "authorization_url" TEXT;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "redirect_uri" TEXT;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "resource_uri" TEXT;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "resource_metadata_url" TEXT;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "oauth_client_id" TEXT;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "oauth_client_secret" TEXT;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "oauth_client_id_issued_at" INTEGER;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "oauth_client_secret_expires_at" INTEGER;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "registration_mode" TEXT;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "token_endpoint_auth_method" TEXT;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "initiator_user_id" TEXT REFERENCES "accounts"("id") ON DELETE CASCADE;
ALTER TABLE "mcp_oauth_pending" ADD COLUMN "browser_nonce" TEXT;

ALTER TABLE "mcp_servers" ADD COLUMN "oauth_resource_uri" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_resource_metadata_url" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_client_id" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_client_secret" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_client_id_issued_at" INTEGER;
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_client_secret_expires_at" INTEGER;
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_registration_mode" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_token_endpoint_auth_method" TEXT;
