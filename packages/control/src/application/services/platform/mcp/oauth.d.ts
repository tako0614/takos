/**
 * MCP Service - OAuth Flow
 *
 * OAuth metadata discovery, PKCE pending state management,
 * token exchange, token refresh, and access token decryption.
 */
import type { D1Database } from '../../../../shared/types/bindings.ts';
import type { Env } from '../../../../shared/types';
import type { OAuthMetadata, McpOAuthPendingParams, McpEndpointUrlOptions } from './mcp-models';
/** Fetch OAuth 2.0 server metadata from /.well-known/oauth-authorization-server */
export declare function discoverOAuthMetadata(serverUrl: string, options?: McpEndpointUrlOptions): Promise<OAuthMetadata>;
/**
 * Create a PKCE pending record and return the authorization URL to redirect the user to.
 */
export declare function createMcpOAuthPending(dbBinding: D1Database, env: Env, params: McpOAuthPendingParams): Promise<{
    authUrl: string;
    state: string;
}>;
/**
 * Retrieve and atomically delete a pending OAuth record by state.
 * Returns null if not found or expired (replay protection).
 */
export declare function consumeMcpOAuthPending(dbBinding: D1Database, env: Env, state: string): Promise<{
    id: string;
    spaceId: string;
    serverName: string;
    serverUrl: string;
    issuerUrl: string;
    codeVerifier: string;
    tokenEndpoint: string;
    scope: string | null;
} | null>;
/**
 * Exchange an authorization code for tokens and upsert the mcp_servers record.
 */
export declare function completeMcpOAuthFlow(dbBinding: D1Database, env: Env, params: {
    spaceId: string;
    serverName: string;
    serverUrl: string;
    tokenEndpoint: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    scope: string | null;
    issuerUrl: string;
}): Promise<{
    serverId: string;
}>;
/**
 * Refresh the OAuth token for an MCP server using its stored refresh token.
 * Updates the server record with new tokens. Non-fatal on failure (logs error).
 */
export declare function refreshMcpToken(dbBinding: D1Database, env: Env, server: {
    id: string;
    oauthRefreshToken: string | null;
    oauthIssuerUrl: string | null;
}): Promise<void>;
export declare function decryptAccessToken(dbBinding: D1Database, env: Env, server: {
    id: string;
    oauthAccessToken: string | null;
}): Promise<string | null>;
//# sourceMappingURL=oauth.d.ts.map