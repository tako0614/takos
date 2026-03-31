/**
 * MCP Service - OAuth Flow
 *
 * OAuth metadata discovery, PKCE pending state management,
 * token exchange, token refresh, and access token decryption.
 */

import type { D1Database } from '../../../../shared/types/bindings.ts';
import type { InsertOf } from '../../../../shared/types/drizzle-utils.ts';
import { getDb, mcpServers, mcpOauthPending } from '../../../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';
import { generateId } from '../../../../shared/utils/index.ts';
import type { Env } from '../../../../shared/types/index.ts';
import { logError } from '../../../../shared/utils/logger.ts';
import type {
  OAuthMetadata,
  McpOAuthPendingParams,
  McpEndpointUrlOptions,
  TokenResponse,
} from './mcp-models.ts';
import { STRICT_MCP_ENDPOINT_URL_OPTIONS } from './mcp-models.ts';
import { assertAllowedMcpEndpointUrl, getMcpEndpointUrlOptions } from './validation.ts';
import {
  generateCodeVerifier,
  deriveCodeChallenge,
  generateState,
  saltFor,
  encryptToken,
  decryptToken,
} from './crypto.ts';

// ---------------------------------------------------------------------------
// OAuth Metadata Discovery
// ---------------------------------------------------------------------------

/** Fetch OAuth 2.0 server metadata from /.well-known/oauth-authorization-server */
export async function discoverOAuthMetadata(
  serverUrl: string,
  options: McpEndpointUrlOptions = STRICT_MCP_ENDPOINT_URL_OPTIONS,
): Promise<OAuthMetadata> {
  const base = assertAllowedMcpEndpointUrl(serverUrl, options, 'MCP server');
  const metaUrl = new URL('/.well-known/oauth-authorization-server', base);

  const response = await fetch(metaUrl.toString(), {
    headers: { Accept: 'application/json' },
    // 10-second timeout via AbortController
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `OAuth metadata discovery failed: ${response.status} ${response.statusText}`,
    );
  }

  const meta = await response.json() as OAuthMetadata;

  if (!meta.issuer || !meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error('OAuth metadata missing required fields (issuer, authorization_endpoint, token_endpoint)');
  }

  assertAllowedMcpEndpointUrl(meta.issuer, options, 'OAuth issuer');
  assertAllowedMcpEndpointUrl(meta.authorization_endpoint, options, 'OAuth authorization endpoint');
  assertAllowedMcpEndpointUrl(meta.token_endpoint, options, 'OAuth token endpoint');

  return meta;
}

// ---------------------------------------------------------------------------
// Pending OAuth state management
// ---------------------------------------------------------------------------

/**
 * Create a PKCE pending record and return the authorization URL to redirect the user to.
 */
export async function createMcpOAuthPending(
  dbBinding: D1Database,
  env: Env,
  params: McpOAuthPendingParams,
): Promise<{ authUrl: string; state: string }> {
  const masterSecret = env.ENCRYPTION_KEY;
  if (!masterSecret) throw new Error('ENCRYPTION_KEY not configured');

  const db = getDb(dbBinding);
  const id = generateId(16);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);

  // Encrypt the code verifier before storing
  const encryptedVerifier = await encryptToken(codeVerifier, masterSecret, saltFor(id, 'verifier'));

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  await db.insert(mcpOauthPending).values({
    id,
    accountId: params.spaceId,
    serverName: params.serverName,
    serverUrl: params.serverUrl,
    state,
    codeVerifier: encryptedVerifier,
    issuerUrl: params.issuerUrl,
    tokenEndpoint: params.tokenEndpoint,
    scope: params.scope ?? null,
    expiresAt,
  });

  const authUrl = new URL(params.authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', 'takos');
  authUrl.searchParams.set('redirect_uri', params.redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  if (params.scope) authUrl.searchParams.set('scope', params.scope);

  return { authUrl: authUrl.toString(), state };
}

/**
 * Retrieve and atomically delete a pending OAuth record by state.
 * Returns null if not found or expired (replay protection).
 */
export async function consumeMcpOAuthPending(
  dbBinding: D1Database,
  env: Env,
  state: string,
): Promise<{
  id: string;
  spaceId: string;
  serverName: string;
  serverUrl: string;
  issuerUrl: string;
  codeVerifier: string;
  tokenEndpoint: string;
  scope: string | null;
} | null> {
  const masterSecret = env.ENCRYPTION_KEY;
  if (!masterSecret) throw new Error('ENCRYPTION_KEY not configured');

  const db = getDb(dbBinding);

  const pending = await db.select().from(mcpOauthPending)
    .where(eq(mcpOauthPending.state, state)).get();
  if (!pending) return null;

  // Check expiry
  if (new Date(pending.expiresAt) < new Date()) {
    await db.delete(mcpOauthPending).where(eq(mcpOauthPending.state, state));
    return null;
  }

  // Atomically delete to prevent replay
  await db.delete(mcpOauthPending).where(eq(mcpOauthPending.state, state));

  const codeVerifier = await decryptToken(
    pending.codeVerifier,
    masterSecret,
    saltFor(pending.id, 'verifier'),
  );

  return {
    id: pending.id,
    spaceId: pending.accountId,
    serverName: pending.serverName,
    serverUrl: pending.serverUrl,
    issuerUrl: pending.issuerUrl,
    codeVerifier,
    tokenEndpoint: pending.tokenEndpoint,
    scope: pending.scope,
  };
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for tokens and upsert the mcp_servers record.
 */
export async function completeMcpOAuthFlow(
  dbBinding: D1Database,
  env: Env,
  params: {
    spaceId: string;
    serverName: string;
    serverUrl: string;
    tokenEndpoint: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    scope: string | null;
    issuerUrl: string;
  },
): Promise<{ serverId: string }> {
  const masterSecret = env.ENCRYPTION_KEY;
  if (!masterSecret) throw new Error('ENCRYPTION_KEY not configured');
  const urlOptions = getMcpEndpointUrlOptions(env);
  assertAllowedMcpEndpointUrl(params.serverUrl, urlOptions, 'MCP server');
  assertAllowedMcpEndpointUrl(params.tokenEndpoint, urlOptions, 'OAuth token endpoint');
  assertAllowedMcpEndpointUrl(params.issuerUrl, urlOptions, 'OAuth issuer');

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: 'takos',
    code_verifier: params.codeVerifier,
  });

  const tokenResp = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text().catch(() => tokenResp.statusText);
    throw new Error(`Token exchange failed: ${tokenResp.status} ${errText}`);
  }

  const tokens = await tokenResp.json() as TokenResponse;
  if (!tokens.access_token) throw new Error('Token response missing access_token');

  const db = getDb(dbBinding);

  const nowIso = new Date().toISOString();

  // Look up first to get stable ID for encryption, then upsert atomically.
  const existing = await db.select({ id: mcpServers.id }).from(mcpServers)
    .where(and(eq(mcpServers.accountId, params.spaceId), eq(mcpServers.name, params.serverName)))
    .get();
  const serverId = existing?.id ?? generateId(16);

  const encryptedAccess = await encryptToken(
    tokens.access_token,
    masterSecret,
    saltFor(serverId, 'access'),
  );
  const encryptedRefresh = tokens.refresh_token
    ? await encryptToken(tokens.refresh_token, masterSecret, saltFor(serverId, 'refresh'))
    : null;

  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  // Use insert ... onConflictDoUpdate to upsert
  await db.insert(mcpServers).values({
    id: serverId,
    accountId: params.spaceId,
    name: params.serverName,
    url: params.serverUrl,
    transport: 'streamable-http',
    oauthAccessToken: encryptedAccess,
    oauthRefreshToken: encryptedRefresh,
    oauthTokenExpiresAt: tokenExpiresAt,
    oauthScope: tokens.scope ?? params.scope,
    oauthIssuerUrl: params.issuerUrl,
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({
    target: mcpServers.id,
    set: {
      oauthAccessToken: encryptedAccess,
      oauthRefreshToken: encryptedRefresh,
      oauthTokenExpiresAt: tokenExpiresAt,
      oauthScope: tokens.scope ?? params.scope,
      oauthIssuerUrl: params.issuerUrl,
      enabled: true,
      updatedAt: nowIso,
    },
  });

  return { serverId };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Refresh the OAuth token for an MCP server using its stored refresh token.
 * Updates the server record with new tokens. Non-fatal on failure (logs error).
 */
export async function refreshMcpToken(
  dbBinding: D1Database,
  env: Env,
  server: { id: string; oauthRefreshToken: string | null; oauthIssuerUrl: string | null },
): Promise<void> {
  const masterSecret = env.ENCRYPTION_KEY;
  if (!masterSecret || !server.oauthRefreshToken || !server.oauthIssuerUrl) return;

  try {
    const urlOptions = getMcpEndpointUrlOptions(env);
    const refreshToken = await decryptToken(
      server.oauthRefreshToken,
      masterSecret,
      saltFor(server.id, 'refresh'),
    );

    // Discover token endpoint
    const meta = await discoverOAuthMetadata(server.oauthIssuerUrl, urlOptions);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'takos',
    });

    const tokenResp = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!tokenResp.ok) {
      logError(`Token refresh failed for server ${server.id}: ${tokenResp.status}`, undefined, { module: 'mcp' });
      return;
    }

    const tokens = await tokenResp.json() as TokenResponse;
    if (!tokens.access_token) return;

    const encryptedAccess = await encryptToken(
      tokens.access_token,
      masterSecret,
      saltFor(server.id, 'access'),
    );
    const encryptedRefresh = tokens.refresh_token
      ? await encryptToken(tokens.refresh_token, masterSecret, saltFor(server.id, 'refresh'))
      : null;

    const tokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    const db = getDb(dbBinding);
    const updateData: Partial<InsertOf<typeof mcpServers>> = {
      oauthAccessToken: encryptedAccess,
      updatedAt: new Date().toISOString(),
    };
    if (encryptedRefresh) updateData.oauthRefreshToken = encryptedRefresh;
    if (tokenExpiresAt) updateData.oauthTokenExpiresAt = tokenExpiresAt;

    await db.update(mcpServers)
      .set(updateData)
      .where(eq(mcpServers.id, server.id));
  } catch (err) {
    logError(`Token refresh error for server ${server.id}`, err, { module: 'mcp' });
  }
}

// ---------------------------------------------------------------------------
// Decrypt access token for use in McpClient
// ---------------------------------------------------------------------------

export async function decryptAccessToken(
  dbBinding: D1Database,
  env: Env,
  server: { id: string; oauthAccessToken: string | null },
): Promise<string | null> {
  if (!server.oauthAccessToken) return null;
  const masterSecret = env.ENCRYPTION_KEY;
  if (!masterSecret) return null;
  try {
    return await decryptToken(server.oauthAccessToken, masterSecret, saltFor(server.id, 'access'));
  } catch {
    return null;
  }
}
