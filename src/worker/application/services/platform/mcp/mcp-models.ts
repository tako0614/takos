/**
 * MCP Service - Type definitions
 *
 * Shared types, interfaces, and constants used across MCP modules.
 */

import type { Env } from "../../../../shared/types/index.ts";
import type { SelectOf } from "../../../../shared/types/drizzle-utils.ts";
import type { mcpServers } from "../../../../infra/db/index.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpOAuthRegistrationMode =
  "preregistered" | "client_metadata_document" | "dynamic";

export type McpAuthorizationStatus =
  | "not_required"
  | "authorized"
  | "authorization_required"
  | "reauthorization_required"
  | "managed";

export interface McpOAuthPendingParams {
  spaceId: string;
  initiatorUserId: string;
  serverName: string;
  serverUrl: string;
  issuerUrl: string;
  tokenEndpoint: string;
  authorizationEndpoint: string;
  authorizationUrl: string;
  resourceUri: string;
  resourceMetadataUrl: string;
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  registrationMode: McpOAuthRegistrationMode;
  tokenEndpointAuthMethod:
    "none" | "client_secret_basic" | "client_secret_post";
  scope?: string;
  redirectUri: string;
  browserNonce: string;
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
  oauthRegistrationMode: string | null;
  oauthTokenExpiresAt: string | null;
  authorizationStatus: McpAuthorizationStatus;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterExternalMcpServerResult {
  status: "already_registered" | "registered" | "pending_oauth";
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

export type McpIssuerEnv = Pick<
  Env,
  "SERVICE_INTERNAL_JWT_ISSUER" | "ADMIN_DOMAIN"
>;

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

export function getInternalMcpIssuer(
  env: Pick<Env, "SERVICE_INTERNAL_JWT_ISSUER" | "ADMIN_DOMAIN">,
): string {
  return env.SERVICE_INTERNAL_JWT_ISSUER || `https://${env.ADMIN_DOMAIN}`;
}

export function mapMcpServerRow(
  row: SelectOf<typeof mcpServers>,
): McpServerRecord {
  const tokenExpired = row.oauthTokenExpiresAt
    ? new Date(row.oauthTokenExpiresAt).getTime() <= Date.now()
    : false;
  const authorizationStatus: McpAuthorizationStatus =
    row.authMode === "none"
      ? "not_required"
      : row.authMode === "oauth_pkce"
        ? !row.oauthAccessToken
          ? row.oauthIssuerUrl
            ? "reauthorization_required"
            : "authorization_required"
          : tokenExpired && !row.oauthRefreshToken
            ? "reauthorization_required"
            : "authorized"
        : "managed";

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
    oauthRegistrationMode: row.oauthRegistrationMode,
    oauthTokenExpiresAt: row.oauthTokenExpiresAt ?? null,
    authorizationStatus,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
