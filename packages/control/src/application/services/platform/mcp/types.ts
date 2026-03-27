/**
 * MCP Service - Type definitions
 *
 * Shared types, interfaces, and constants used across MCP modules.
 */

import type { Env } from '../../../../shared/types';
import type { mcpServers } from '../../../../infra/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STRICT_MCP_ENDPOINT_URL_OPTIONS: McpEndpointUrlOptions = {
  allowHttp: false,
  allowLocalhost: false,
  allowPrivateIp: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getInternalMcpIssuer(env: Pick<Env, 'SERVICE_INTERNAL_JWT_ISSUER' | 'ADMIN_DOMAIN'>): string {
  return env.SERVICE_INTERNAL_JWT_ISSUER || `https://${env.ADMIN_DOMAIN}`;
}

export function mapMcpServerRow(row: typeof mcpServers.$inferSelect): McpServerRecord {
  return {
    id: row.id,
    spaceId: row.accountId,
    name: row.name,
    url: row.url,
    transport: row.transport,
    sourceType: row.sourceType,
    authMode: row.authMode,
    serviceId: row.serviceId,
    bundleDeploymentId: row.bundleDeploymentId,
    oauthScope: row.oauthScope,
    oauthIssuerUrl: row.oauthIssuerUrl,
    oauthTokenExpiresAt: row.oauthTokenExpiresAt ?? null,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
