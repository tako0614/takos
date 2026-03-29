/**
 * MCP Service - Type definitions
 *
 * Shared types, interfaces, and constants used across MCP modules.
 */
import type { Env } from '../../../../shared/types';
import type { SelectOf } from '../../../../shared/types/drizzle-utils';
import type { mcpServers } from '../../../../infra/db';
export interface OAuthMetadata {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    scopes_supported?: string[];
    response_types_supported?: string[];
    code_challenge_methods_supported?: string[];
}
export interface McpOAuthPendingParams {
    spaceId: string;
    serverName: string;
    serverUrl: string;
    issuerUrl: string;
    tokenEndpoint: string;
    authorizationEndpoint: string;
    scope?: string;
    redirectUri: string;
}
export interface McpOAuthCompletionParams {
    state: string;
    code: string;
    redirectUri: string;
}
export interface McpServerRecord {
    id: string;
    spaceId: string;
    name: string;
    url: string;
    transport: string;
    sourceType: string;
    authMode: string;
    serviceId: string | null;
    bundleDeploymentId: string | null;
    oauthScope: string | null;
    oauthIssuerUrl: string | null;
    oauthTokenExpiresAt: string | null;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface RegisterExternalMcpServerResult {
    status: 'already_registered' | 'registered' | 'pending_oauth';
    name: string;
    url: string;
    authUrl?: string;
    message: string;
}
export interface McpEndpointUrlOptions {
    allowHttp: boolean;
    allowLocalhost: boolean;
    allowPrivateIp: boolean;
}
export interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
}
export type McpIssuerEnv = Pick<Env, 'SERVICE_INTERNAL_JWT_ISSUER' | 'ADMIN_DOMAIN'>;
export declare const STRICT_MCP_ENDPOINT_URL_OPTIONS: McpEndpointUrlOptions;
export declare function getInternalMcpIssuer(env: Pick<Env, 'SERVICE_INTERNAL_JWT_ISSUER' | 'ADMIN_DOMAIN'>): string;
export declare function mapMcpServerRow(row: SelectOf<typeof mcpServers>): McpServerRecord;
//# sourceMappingURL=mcp-models.d.ts.map