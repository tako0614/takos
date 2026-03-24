/**
 * MCP Service
 *
 * Handles OAuth discovery, PKCE flow, token storage, and CRUD for MCP servers.
 * Tokens are stored AES-256-GCM encrypted using the workspace's ENCRYPTION_KEY.
 */

import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, mcpServers, mcpOauthPending } from '../../../infra/db';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt, type EncryptedData } from '../../../shared/utils/crypto';
import { generateId } from '../../../shared/utils';
import type { Env } from '../../../shared/types';
import { isLocalhost, isPrivateIP } from '@takos/common/validation';
import { logError } from '../../../shared/utils/logger';

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

interface McpServerRow {
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

const STRICT_MCP_ENDPOINT_URL_OPTIONS: McpEndpointUrlOptions = {
  allowHttp: false,
  allowLocalhost: false,
  allowPrivateIp: false,
};

function toNullableIsoString(value: string | null): string | null {
  if (!value) return null;
  return value;
}

function getInternalMcpIssuer(env: Pick<Env, 'SERVICE_INTERNAL_JWT_ISSUER' | 'ADMIN_DOMAIN'>): string {
  return env.SERVICE_INTERNAL_JWT_ISSUER || `https://${env.ADMIN_DOMAIN}`;
}

function mapMcpServerRow(row: typeof mcpServers.$inferSelect): McpServerRecord {
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

function normalizeMcpEndpointHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

export function getMcpEndpointUrlOptions(env: Pick<Env, 'ENVIRONMENT'>): McpEndpointUrlOptions {
  const isDev = env.ENVIRONMENT === 'development';
  return {
    allowHttp: isDev,
    allowLocalhost: isDev,
    allowPrivateIp: isDev,
  };
}

export function assertAllowedMcpEndpointUrl(
  rawUrl: string,
  options: McpEndpointUrlOptions,
  label: string,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} URL is invalid`);
  }

  if (parsed.protocol !== 'https:' && !(options.allowHttp && parsed.protocol === 'http:')) {
    throw new Error(`${label} URL must use ${options.allowHttp ? 'HTTP or HTTPS' : 'HTTPS'}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} URL must not include credentials`);
  }

  const normalizedHost = normalizeMcpEndpointHost(parsed.hostname);
  if (!options.allowLocalhost && isLocalhost(normalizedHost)) {
    throw new Error(`${label} URL host is not allowed`);
  }
  if (!options.allowPrivateIp && isPrivateIP(normalizedHost)) {
    throw new Error(`${label} URL host is not allowed`);
  }
  // Block bare hostnames (no dots) and IPv6 addresses without dots
  // that could bypass the isLocalhost/isPrivateIP checks above
  if (!options.allowLocalhost && !normalizedHost.includes('.') && !normalizedHost.includes(':')) {
    throw new Error(`${label} URL host must be publicly routable`);
  }
  // Explicitly check for IPv6 loopback that may bypass dot-based checks
  if (!options.allowLocalhost && (normalizedHost === '::1' || normalizedHost === '[::1]')) {
    throw new Error(`${label} URL host is not allowed`);
  }

  return parsed;
}

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
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateRandomToken(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return base64UrlEncode(raw);
}

function generateCodeVerifier(): string {
  return generateRandomToken();
}

async function deriveCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

function generateState(): string {
  return generateRandomToken();
}

// ---------------------------------------------------------------------------
// Encryption helpers (tokens)
// ---------------------------------------------------------------------------

function saltFor(serverId: string, field: 'access' | 'refresh' | 'verifier'): string {
  return `mcp:token:${field}:${serverId}`;
}

async function encryptToken(
  token: string,
  masterSecret: string,
  salt: string,
): Promise<string> {
  const encrypted = await encrypt(token, masterSecret, salt);
  return JSON.stringify(encrypted);
}

async function decryptToken(
  encryptedJson: string,
  masterSecret: string,
  salt: string,
): Promise<string> {
  const parsed = JSON.parse(encryptedJson) as EncryptedData;
  return decrypt(parsed, masterSecret, salt);
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
// Token exchange and storage
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

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

export async function registerExternalMcpServer(
  dbBinding: D1Database,
  env: Env,
  params: {
    spaceId: string;
    name: string;
    url: string;
    scope?: string;
  },
): Promise<RegisterExternalMcpServerResult> {
  const urlOptions = getMcpEndpointUrlOptions(env);
  assertAllowedMcpEndpointUrl(params.url, urlOptions, 'MCP server');

  if (!params.name || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(params.name)) {
    throw new Error(
      'name must start with a letter and contain only letters, digits, underscores, or hyphens (max 64 chars)',
    );
  }

  const db = getDb(dbBinding);
  const existing = await db.select({
    id: mcpServers.id,
    oauthAccessToken: mcpServers.oauthAccessToken,
  }).from(mcpServers)
    .where(and(eq(mcpServers.accountId, params.spaceId), eq(mcpServers.name, params.name)))
    .get();

  if (existing && existing.oauthAccessToken) {
    return {
      status: 'already_registered',
      name: params.name,
      url: params.url,
      message: `MCP server "${params.name}" is already registered with an active OAuth token.`,
    };
  }

  try {
    const meta = await discoverOAuthMetadata(params.url, urlOptions);
    const redirectUri = `https://${env.ADMIN_DOMAIN || env.TENANT_BASE_DOMAIN || 'localhost'}/api/mcp/oauth/callback`;
    const { authUrl } = await createMcpOAuthPending(dbBinding, env, {
      spaceId: params.spaceId,
      serverName: params.name,
      serverUrl: params.url,
      issuerUrl: meta.issuer,
      tokenEndpoint: meta.token_endpoint,
      authorizationEndpoint: meta.authorization_endpoint,
      scope: params.scope,
      redirectUri,
    });

    return {
      status: 'pending_oauth',
      name: params.name,
      url: params.url,
      authUrl,
      message: `Authorize MCP server "${params.name}" to finish registration.`,
    };
  } catch (err) {
    const nowIso = new Date().toISOString();
    const serverId = existing?.id ?? generateId(16);
    // Use upsert to avoid race between concurrent registrations
    await db.insert(mcpServers).values({
      id: serverId,
      accountId: params.spaceId,
      name: params.name,
      url: params.url,
      transport: 'streamable-http',
      sourceType: 'external',
      authMode: 'oauth_pkce',
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    }).onConflictDoUpdate({
      target: mcpServers.id,
      set: {
        url: params.url,
        transport: 'streamable-http',
        sourceType: 'external',
        authMode: 'oauth_pkce',
        enabled: true,
        updatedAt: nowIso,
      },
    });

    return {
      status: 'registered',
      name: params.name,
      url: params.url,
      message: `MCP server "${params.name}" registered without OAuth metadata (${String(err)}).`,
    };
  }
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
    const updateData: Partial<typeof mcpServers.$inferInsert> = {
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

type McpIssuerEnv = Pick<Env, 'SERVICE_INTERNAL_JWT_ISSUER' | 'ADMIN_DOMAIN'>;

export async function upsertManagedMcpServer(
  dbBinding: D1Database,
  env: McpIssuerEnv,
  params: {
    spaceId: string;
    name: string;
    url: string;
    sourceType: 'worker' | 'bundle_deployment';
    serviceId?: string | null;
    workerId?: string | null;
    bundleDeploymentId?: string | null;
  },
): Promise<McpServerRecord> {
  const db = getDb(dbBinding);
  const nowIso = new Date().toISOString();
  const serviceId = params.serviceId ?? params.workerId ?? null;

  let existing: { id: string } | undefined;
  if (params.sourceType === 'worker' && serviceId) {
    existing = await db.select({ id: mcpServers.id }).from(mcpServers)
      .where(and(
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.sourceType, 'worker'),
        eq(mcpServers.serviceId, serviceId),
      ))
      .get();
  } else {
    const conditions = [
      eq(mcpServers.accountId, params.spaceId),
      eq(mcpServers.name, params.name),
      eq(mcpServers.sourceType, params.sourceType),
    ];
    if (params.bundleDeploymentId) {
      conditions.push(eq(mcpServers.bundleDeploymentId, params.bundleDeploymentId));
    }
    existing = await db.select({ id: mcpServers.id }).from(mcpServers)
      .where(and(...conditions))
      .get();
  }

  const serverId = existing?.id ?? generateId(16);
  await db.insert(mcpServers).values({
    id: serverId,
    accountId: params.spaceId,
    name: params.name,
    url: params.url,
    transport: 'streamable-http',
    sourceType: params.sourceType,
    authMode: 'takos_oidc',
    serviceId,
    bundleDeploymentId: params.bundleDeploymentId ?? null,
    oauthIssuerUrl: getInternalMcpIssuer(env),
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({
    target: mcpServers.id,
    set: {
      name: params.name,
      url: params.url,
      transport: 'streamable-http',
      sourceType: params.sourceType,
      authMode: 'takos_oidc',
      serviceId,
      bundleDeploymentId: params.bundleDeploymentId ?? null,
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthTokenExpiresAt: null,
      oauthScope: null,
      oauthIssuerUrl: getInternalMcpIssuer(env),
      enabled: true,
      updatedAt: nowIso,
    },
  });

  const row = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
  return mapMcpServerRow(row!);
}

export async function reconcileManagedWorkerMcpServer(
  dbBinding: D1Database,
  env: McpIssuerEnv,
  params: {
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    name?: string | null;
    url?: string | null;
    enabled: boolean;
  },
): Promise<void> {
  const db = getDb(dbBinding);
  const serviceId = params.serviceId ?? params.workerId;
  if (!serviceId) {
    throw new Error('Managed MCP reconciliation requires a service identifier');
  }
  if (!params.enabled || !params.name || !params.url) {
    await db.delete(mcpServers)
      .where(and(
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.sourceType, 'worker'),
        eq(mcpServers.serviceId, serviceId),
      ));
    return;
  }

  await upsertManagedMcpServer(dbBinding, env, {
    spaceId: params.spaceId,
    sourceType: 'worker',
    serviceId,
    name: params.name,
    url: params.url,
  });
}

export async function deleteManagedMcpServersByBundleDeployment(
  dbBinding: D1Database,
  spaceId: string,
  bundleDeploymentId: string,
): Promise<void> {
  const db = getDb(dbBinding);
  await db.delete(mcpServers)
    .where(and(
      eq(mcpServers.accountId, spaceId),
      eq(mcpServers.sourceType, 'bundle_deployment'),
      eq(mcpServers.bundleDeploymentId, bundleDeploymentId),
    ));
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getMcpServerWithTokens(
  dbBinding: D1Database,
  spaceId: string,
  serverId: string,
): Promise<(typeof mcpServers.$inferSelect) | null> {
  const db = getDb(dbBinding);
  const row = await db.select().from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.accountId, spaceId)))
    .get();
  return row ?? null;
}

export async function listMcpServers(
  dbBinding: D1Database,
  spaceId: string,
): Promise<McpServerRecord[]> {
  const db = getDb(dbBinding);
  const rows = await db.select().from(mcpServers)
    .where(eq(mcpServers.accountId, spaceId))
    .orderBy(mcpServers.createdAt)
    .all();
  return rows.map(mapMcpServerRow);
}

export async function deleteMcpServer(
  dbBinding: D1Database,
  spaceId: string,
  serverId: string,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const existing = await db.select({
    id: mcpServers.id,
    sourceType: mcpServers.sourceType,
  }).from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.accountId, spaceId)))
    .get();
  if (!existing) return false;
  if (existing.sourceType !== 'external') {
    throw new Error('Managed MCP servers must be removed from their source (worker or bundle deployment)');
  }
  await db.delete(mcpServers).where(eq(mcpServers.id, serverId));
  return true;
}

export async function updateMcpServer(
  dbBinding: D1Database,
  spaceId: string,
  serverId: string,
  patch: { enabled?: boolean; name?: string },
): Promise<McpServerRecord | null> {
  const db = getDb(dbBinding);
  const existing = await db.select({
    id: mcpServers.id,
    sourceType: mcpServers.sourceType,
  }).from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.accountId, spaceId)))
    .get();
  if (!existing) return null;
  if (existing.sourceType !== 'external' && patch.name !== undefined) {
    throw new Error('Managed MCP server names are controlled by their source declaration');
  }

  const updateData: Partial<typeof mcpServers.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.enabled !== undefined) updateData.enabled = patch.enabled;
  if (patch.name !== undefined) updateData.name = patch.name;

  await db.update(mcpServers)
    .set(updateData)
    .where(eq(mcpServers.id, serverId));

  const updated = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
  return updated ? mapMcpServerRow(updated) : null;
}
