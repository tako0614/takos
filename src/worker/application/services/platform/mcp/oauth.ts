/**
 * MCP Service - OAuth flow persistence and encrypted credentials.
 */

import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import {
  exchangeAuthorization,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import type { InsertOf } from "../../../../shared/types/drizzle-utils.ts";
import {
  getDb,
  mcpOauthPending,
  mcpServers,
} from "../../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { generateId } from "../../../../shared/utils/index.ts";
import type { Env } from "../../../../shared/types/index.ts";
import { logError } from "../../../../shared/utils/logger.ts";
import { affectedRowCount } from "../../../../shared/utils/affected-row-count.ts";
import { constantTimeEqualsString } from "takosumi-contract/internal-crypto";
import type {
  McpOAuthPendingParams,
  McpOAuthRegistrationMode,
} from "./mcp-models.ts";
import { STRICT_MCP_ENDPOINT_URL_OPTIONS } from "./mcp-models.ts";
import {
  assertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions,
} from "./validation.ts";
import { ConflictError } from "@takos/worker-platform-utils/errors";
import {
  decryptToken,
  encryptToken,
  generateState,
  saltFor,
} from "./crypto.ts";
import {
  createMcpOAuthFetch,
  discoverMcpAuthorization,
  prepareMcpOAuthAuthorization,
  registerMcpOAuthClient,
  resolveMcpOAuthPublicUrls,
  type McpOAuthClientRegistration,
} from "./authorization.ts";

export const mcpServiceDeps = {
  getDb,
};

export type BeginMcpAuthorizationResult =
  { kind: "public" } | { kind: "oauth"; authUrl: string };

/**
 * Complete discovery and client registration, then persist an encrypted PKCE
 * pending record. A public result is returned only after a valid MCP handshake;
 * discovery, registration, encryption, and DB failures remain hard failures.
 */
export async function beginMcpAuthorization(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  params: {
    spaceId: string;
    initiatorUserId: string;
    serverName: string;
    serverUrl: string;
    scope?: string;
    existingClient?: {
      serverId: string;
      issuerUrl: string | null;
      clientId: string | null;
      encryptedClientSecret: string | null;
      clientIdIssuedAt: number | null;
      clientSecretExpiresAt: number | null;
      registrationMode: string | null;
      tokenEndpointAuthMethod: string | null;
    };
  },
  clock: Clock = systemClock,
): Promise<BeginMcpAuthorizationResult> {
  const options = getMcpEndpointUrlOptions(env);
  const discovery = await discoverMcpAuthorization(
    params.serverUrl,
    env,
    params.spaceId,
    options,
  );
  if (discovery.kind === "public") return discovery;

  let client: McpOAuthClientRegistration | null = null;
  const stored = params.existingClient;
  const storedIssuerMatches = (() => {
    if (!stored?.issuerUrl) return false;
    return stored.issuerUrl === discovery.authorizationServerUrl;
  })();
  const storedClientSecretValid =
    !stored?.clientSecretExpiresAt ||
    stored.clientSecretExpiresAt === 0 ||
    stored.clientSecretExpiresAt * 1000 > clock.now();
  if (
    storedIssuerMatches &&
    storedClientSecretValid &&
    stored?.clientId &&
    stored.registrationMode &&
    isRegistrationMode(stored.registrationMode) &&
    isTokenEndpointAuthMethod(stored.tokenEndpointAuthMethod)
  ) {
    const masterSecret = env.ENCRYPTION_KEY;
    if (!masterSecret) throw new Error("ENCRYPTION_KEY not configured");
    const clientSecret = stored.encryptedClientSecret
      ? await decryptToken(
          stored.encryptedClientSecret,
          masterSecret,
          saltFor(stored.serverId, "client-secret"),
        )
      : undefined;
    client = {
      clientId: stored.clientId,
      ...(clientSecret ? { clientSecret } : {}),
      clientIdIssuedAt: stored.clientIdIssuedAt ?? undefined,
      clientSecretExpiresAt: stored.clientSecretExpiresAt ?? undefined,
      registrationMode: stored.registrationMode,
      tokenEndpointAuthMethod: stored.tokenEndpointAuthMethod,
    };
  }
  client ??= await registerMcpOAuthClient(
    params.serverUrl,
    discovery,
    env,
    params.spaceId,
    options,
    params.scope,
  );

  const state = generateState();
  const browserNonce = generateState();
  const prepared = await prepareMcpOAuthAuthorization(
    params.serverUrl,
    discovery,
    client,
    env,
    state,
    params.scope,
  );
  await createMcpOAuthPending(
    dbBinding,
    env,
    {
      spaceId: params.spaceId,
      initiatorUserId: params.initiatorUserId,
      serverName: params.serverName,
      serverUrl: params.serverUrl,
      issuerUrl: prepared.authorizationServerUrl,
      authorizationEndpoint: prepared.authorizationEndpoint,
      authorizationUrl: prepared.authorizationUrl.href,
      tokenEndpoint: prepared.tokenEndpoint,
      redirectUri: resolveMcpOAuthPublicUrls(env).redirectUri,
      resourceUri: prepared.resourceUri,
      resourceMetadataUrl: prepared.resourceMetadataUrl,
      clientId: prepared.client.clientId,
      clientSecret: prepared.client.clientSecret,
      clientIdIssuedAt: prepared.client.clientIdIssuedAt,
      clientSecretExpiresAt: prepared.client.clientSecretExpiresAt,
      registrationMode: prepared.client.registrationMode,
      tokenEndpointAuthMethod: prepared.client.tokenEndpointAuthMethod,
      scope: prepared.scope,
      state,
      codeVerifier: prepared.codeVerifier,
      browserNonce,
    },
    clock,
  );
  const publicUrls = resolveMcpOAuthPublicUrls(env);
  const startUrl = new URL("/api/mcp/oauth/start", publicUrls.origin);
  startUrl.searchParams.set("state", state);
  return { kind: "oauth", authUrl: startUrl.href };
}

function isRegistrationMode(value: string): value is McpOAuthRegistrationMode {
  return (
    value === "preregistered" ||
    value === "client_metadata_document" ||
    value === "dynamic"
  );
}

type TokenEndpointAuthMethod =
  "none" | "client_secret_basic" | "client_secret_post";

function isTokenEndpointAuthMethod(
  value: string | null,
): value is TokenEndpointAuthMethod {
  return (
    value === "none" ||
    value === "client_secret_basic" ||
    value === "client_secret_post"
  );
}

/** Persist an already prepared OAuth authorization request. */
export async function createMcpOAuthPending(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  params: McpOAuthPendingParams & { state: string; codeVerifier: string },
  clock: Clock = systemClock,
): Promise<{ state: string }> {
  const masterSecret = env.ENCRYPTION_KEY;
  if (!masterSecret) throw new Error("ENCRYPTION_KEY not configured");

  const db = mcpServiceDeps.getDb(dbBinding);
  const id = generateId(16);
  const encryptedVerifier = await encryptToken(
    params.codeVerifier,
    masterSecret,
    saltFor(id, "verifier"),
  );
  const encryptedClientSecret = params.clientSecret
    ? await encryptToken(
        params.clientSecret,
        masterSecret,
        saltFor(id, "client-secret"),
      )
    : null;
  const encryptedBrowserNonce = await encryptToken(
    params.browserNonce,
    masterSecret,
    saltFor(id, "browser-nonce"),
  );
  const expiresAt = new Date(clock.now() + 10 * 60 * 1000).toISOString();

  await db.insert(mcpOauthPending).values({
    id,
    accountId: params.spaceId,
    initiatorUserId: params.initiatorUserId,
    serverName: params.serverName,
    serverUrl: params.serverUrl,
    state: params.state,
    codeVerifier: encryptedVerifier,
    issuerUrl: params.issuerUrl,
    authorizationEndpoint: params.authorizationEndpoint,
    authorizationUrl: params.authorizationUrl,
    tokenEndpoint: params.tokenEndpoint,
    redirectUri: params.redirectUri,
    resourceUri: params.resourceUri,
    resourceMetadataUrl: params.resourceMetadataUrl,
    oauthClientId: params.clientId,
    oauthClientSecret: encryptedClientSecret,
    oauthClientIdIssuedAt: params.clientIdIssuedAt ?? null,
    oauthClientSecretExpiresAt: params.clientSecretExpiresAt ?? null,
    registrationMode: params.registrationMode,
    tokenEndpointAuthMethod: params.tokenEndpointAuthMethod,
    browserNonce: encryptedBrowserNonce,
    scope: params.scope ?? null,
    expiresAt,
  });
  return { state: params.state };
}

type McpOAuthPendingRecord = {
  id: string;
  spaceId: string;
  initiatorUserId: string;
  serverName: string;
  serverUrl: string;
  issuerUrl: string;
  authorizationEndpoint: string;
  authorizationUrl: string;
  codeVerifier: string;
  browserNonce: string;
  tokenEndpoint: string;
  redirectUri: string;
  resourceUri: string;
  resourceMetadataUrl: string;
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  registrationMode: McpOAuthRegistrationMode;
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  scope: string | null;
  expiresAt: string;
};

export class McpOAuthBrowserBindingError extends Error {
  constructor(message = "MCP OAuth browser binding did not match") {
    super(message);
    this.name = "McpOAuthBrowserBindingError";
  }
}

export class McpOAuthPendingUpgradeRequiredError extends Error {
  constructor() {
    super("OAuth pending state must be restarted with the current client");
    this.name = "McpOAuthPendingUpgradeRequiredError";
  }
}

async function readMcpOAuthPending(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  state: string,
  clock: Clock,
): Promise<McpOAuthPendingRecord | null> {
  const masterSecret = env.ENCRYPTION_KEY;
  if (!masterSecret) throw new Error("ENCRYPTION_KEY not configured");
  const db = mcpServiceDeps.getDb(dbBinding);
  const pending = await db
    .select()
    .from(mcpOauthPending)
    .where(eq(mcpOauthPending.state, state))
    .get();
  if (!pending) return null;

  if (new Date(pending.expiresAt).getTime() <= clock.now()) {
    await db.delete(mcpOauthPending).where(eq(mcpOauthPending.state, state));
    return null;
  }

  if (
    !pending.authorizationEndpoint ||
    !pending.authorizationUrl ||
    !pending.redirectUri ||
    !pending.resourceUri ||
    !pending.resourceMetadataUrl ||
    !pending.oauthClientId ||
    !pending.initiatorUserId ||
    !pending.browserNonce ||
    !pending.registrationMode ||
    !isRegistrationMode(pending.registrationMode) ||
    !isTokenEndpointAuthMethod(pending.tokenEndpointAuthMethod)
  ) {
    throw new McpOAuthPendingUpgradeRequiredError();
  }
  const codeVerifier = await decryptToken(
    pending.codeVerifier,
    masterSecret,
    saltFor(pending.id, "verifier"),
  );
  const clientSecret = pending.oauthClientSecret
    ? await decryptToken(
        pending.oauthClientSecret,
        masterSecret,
        saltFor(pending.id, "client-secret"),
      )
    : undefined;
  const browserNonce = await decryptToken(
    pending.browserNonce,
    masterSecret,
    saltFor(pending.id, "browser-nonce"),
  );
  return {
    id: pending.id,
    spaceId: pending.accountId,
    initiatorUserId: pending.initiatorUserId,
    serverName: pending.serverName,
    serverUrl: pending.serverUrl,
    issuerUrl: pending.issuerUrl,
    authorizationEndpoint: pending.authorizationEndpoint,
    authorizationUrl: pending.authorizationUrl,
    codeVerifier,
    browserNonce,
    tokenEndpoint: pending.tokenEndpoint,
    redirectUri: pending.redirectUri,
    resourceUri: pending.resourceUri,
    resourceMetadataUrl: pending.resourceMetadataUrl,
    clientId: pending.oauthClientId,
    ...(clientSecret ? { clientSecret } : {}),
    clientIdIssuedAt: pending.oauthClientIdIssuedAt ?? undefined,
    clientSecretExpiresAt: pending.oauthClientSecretExpiresAt ?? undefined,
    registrationMode: pending.registrationMode,
    tokenEndpointAuthMethod: pending.tokenEndpointAuthMethod,
    scope: pending.scope,
    expiresAt: pending.expiresAt,
  };
}

export async function getMcpOAuthPendingForStart(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  state: string,
  clock: Clock = systemClock,
): Promise<Pick<
  McpOAuthPendingRecord,
  "initiatorUserId" | "authorizationUrl" | "browserNonce" | "expiresAt"
> | null> {
  const pending = await readMcpOAuthPending(dbBinding, env, state, clock);
  if (!pending) return null;
  return {
    initiatorUserId: pending.initiatorUserId,
    authorizationUrl: pending.authorizationUrl,
    browserNonce: pending.browserNonce,
    expiresAt: pending.expiresAt,
  };
}

export async function consumeMcpOAuthPending(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  params: { state: string; browserNonce: string; issuer: string },
  clock: Clock = systemClock,
): Promise<McpOAuthPendingRecord | null> {
  const pending = await readMcpOAuthPending(
    dbBinding,
    env,
    params.state,
    clock,
  );
  if (!pending) return null;
  if (!constantTimeEqualsString(params.browserNonce, pending.browserNonce)) {
    throw new McpOAuthBrowserBindingError();
  }
  if (params.issuer !== pending.issuerUrl) {
    throw new McpOAuthBrowserBindingError(
      "OAuth authorization server did not match the pending request",
    );
  }

  const deleted = await mcpServiceDeps
    .getDb(dbBinding)
    .delete(mcpOauthPending)
    .where(
      and(
        eq(mcpOauthPending.id, pending.id),
        eq(mcpOauthPending.state, params.state),
      ),
    );
  if (affectedRowCount(deleted) === 0) return null;
  return pending;
}

export async function completeMcpOAuthFlow(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  params: {
    spaceId: string;
    serverName: string;
    serverUrl: string;
    issuerUrl: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    redirectUri: string;
    resourceUri: string;
    resourceMetadataUrl: string;
    clientId: string;
    clientSecret?: string;
    clientIdIssuedAt?: number;
    clientSecretExpiresAt?: number;
    registrationMode: McpOAuthRegistrationMode;
    tokenEndpointAuthMethod: TokenEndpointAuthMethod;
    code: string;
    codeVerifier: string;
    scope: string | null;
  },
  clock: Clock = systemClock,
): Promise<{ serverId: string }> {
  const masterSecret = env.ENCRYPTION_KEY;
  if (!masterSecret) throw new Error("ENCRYPTION_KEY not configured");
  const options = getMcpEndpointUrlOptions(env);
  assertAllowedMcpEndpointUrl(params.serverUrl, options, "MCP server");
  assertAllowedMcpEndpointUrl(params.issuerUrl, options, "OAuth issuer");
  assertAllowedMcpEndpointUrl(
    params.authorizationEndpoint,
    options,
    "OAuth authorization endpoint",
  );
  assertAllowedMcpEndpointUrl(
    params.tokenEndpoint,
    options,
    "OAuth token endpoint",
  );
  const resourceUri = assertAllowedMcpEndpointUrl(
    params.resourceUri,
    options,
    "OAuth resource indicator",
  );
  if (resourceUri.hash) {
    throw new Error("OAuth resource indicator must not include a fragment");
  }
  assertAllowedMcpEndpointUrl(
    params.resourceMetadataUrl,
    options,
    "OAuth Protected Resource Metadata endpoint",
  );

  const db = mcpServiceDeps.getDb(dbBinding);
  const existing = await findExternalMcpServerForEndpoint(db, params);
  if (!existing) await assertNoMcpEndpointCollision(db, params);

  const metadata: AuthorizationServerMetadata = {
    issuer: params.issuerUrl,
    authorization_endpoint: params.authorizationEndpoint,
    token_endpoint: params.tokenEndpoint,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [params.tokenEndpointAuthMethod],
  };
  const clientInformation: OAuthClientInformationMixed = {
    client_id: params.clientId,
    ...(params.clientSecret ? { client_secret: params.clientSecret } : {}),
  };
  const tokens = await exchangeAuthorization(params.issuerUrl, {
    metadata,
    clientInformation,
    authorizationCode: params.code,
    codeVerifier: params.codeVerifier,
    redirectUri: params.redirectUri,
    resource: new URL(params.resourceUri),
    fetchFn: createMcpOAuthFetch(env, params.spaceId, options),
  });

  const nowIso = new Date().toISOString();
  const serverId = existing?.id ?? generateId(16);
  const tokenExpiresAt =
    tokens.expires_in !== undefined
      ? new Date(clock.now() + tokens.expires_in * 1000).toISOString()
      : null;
  const tokenFields = async (
    id: string,
  ): Promise<Partial<InsertOf<typeof mcpServers>>> => ({
    authMode: "oauth_pkce",
    oauthAccessToken: await encryptToken(
      tokens.access_token,
      masterSecret,
      saltFor(id, "access"),
    ),
    oauthRefreshToken: tokens.refresh_token
      ? await encryptToken(
          tokens.refresh_token,
          masterSecret,
          saltFor(id, "refresh"),
        )
      : null,
    oauthTokenExpiresAt: tokenExpiresAt,
    oauthScope: tokens.scope ?? params.scope,
    oauthIssuerUrl: params.issuerUrl,
    oauthResourceUri: params.resourceUri,
    oauthResourceMetadataUrl: params.resourceMetadataUrl,
    oauthClientId: params.clientId,
    oauthClientSecret: params.clientSecret
      ? await encryptToken(
          params.clientSecret,
          masterSecret,
          saltFor(id, "client-secret"),
        )
      : null,
    oauthClientIdIssuedAt: params.clientIdIssuedAt ?? null,
    oauthClientSecretExpiresAt: params.clientSecretExpiresAt ?? null,
    oauthRegistrationMode: params.registrationMode,
    oauthTokenEndpointAuthMethod: params.tokenEndpointAuthMethod,
    enabled: true,
    updatedAt: nowIso,
  });

  if (existing) {
    const updated = await updateMcpTokensForExactEndpoint(
      db,
      params,
      existing.id,
      await tokenFields(existing.id),
    );
    if (!updated) throw mcpEndpointCollision(params.serverName);
    return { serverId: existing.id };
  }

  try {
    await db.insert(mcpServers).values({
      id: serverId,
      accountId: params.spaceId,
      name: params.serverName,
      url: params.serverUrl,
      transport: "streamable-http",
      sourceType: "external",
      ...(await tokenFields(serverId)),
      createdAt: nowIso,
    });
    return { serverId };
  } catch (insertError) {
    const raced = await findExternalMcpServerForEndpoint(db, params);
    if (raced) {
      const updated = await updateMcpTokensForExactEndpoint(
        db,
        params,
        raced.id,
        await tokenFields(raced.id),
      );
      if (updated) return { serverId: raced.id };
    }
    if (await findMcpServerByName(db, params)) {
      throw mcpEndpointCollision(params.serverName);
    }
    throw insertError;
  }
}

type McpOAuthEndpointParams = {
  spaceId: string;
  serverName: string;
  serverUrl: string;
};

function mcpEndpointCollision(serverName: string): ConflictError {
  return new ConflictError(
    `MCP server "${serverName}" is already bound to a different endpoint`,
  );
}

async function findExternalMcpServerForEndpoint(
  db: ReturnType<typeof getDb>,
  params: McpOAuthEndpointParams,
): Promise<{ id: string } | null> {
  const row = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.name, params.serverName),
        eq(mcpServers.url, params.serverUrl),
        eq(mcpServers.sourceType, "external"),
      ),
    )
    .get();
  return row ?? null;
}

async function findMcpServerByName(
  db: ReturnType<typeof getDb>,
  params: McpOAuthEndpointParams,
): Promise<{ id: string } | null> {
  const row = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.name, params.serverName),
      ),
    )
    .get();
  return row ?? null;
}

async function assertNoMcpEndpointCollision(
  db: ReturnType<typeof getDb>,
  params: McpOAuthEndpointParams,
): Promise<void> {
  if (await findMcpServerByName(db, params)) {
    throw mcpEndpointCollision(params.serverName);
  }
}

async function updateMcpTokensForExactEndpoint(
  db: ReturnType<typeof getDb>,
  params: McpOAuthEndpointParams,
  serverId: string,
  tokenFields: Partial<InsertOf<typeof mcpServers>>,
): Promise<boolean> {
  const result = await db
    .update(mcpServers)
    .set(tokenFields)
    .where(
      and(
        eq(mcpServers.id, serverId),
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.name, params.serverName),
        eq(mcpServers.url, params.serverUrl),
        eq(mcpServers.sourceType, "external"),
      ),
    );
  return affectedRowCount(result) > 0;
}

export async function refreshMcpToken(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  server: {
    id: string;
    accountId: string;
    url: string;
    oauthRefreshToken: string | null;
    oauthIssuerUrl: string | null;
    oauthClientId: string | null;
    oauthClientSecret: string | null;
    oauthTokenEndpointAuthMethod: string | null;
    oauthResourceUri: string | null;
  },
  clock: Clock = systemClock,
): Promise<void> {
  const masterSecret = env.ENCRYPTION_KEY;
  if (
    !masterSecret ||
    !server.oauthRefreshToken ||
    !server.oauthIssuerUrl ||
    !server.oauthClientId ||
    !isTokenEndpointAuthMethod(server.oauthTokenEndpointAuthMethod)
  )
    return;

  try {
    const options = getMcpEndpointUrlOptions(env);
    const discovery = await discoverMcpAuthorization(
      server.url,
      env,
      server.accountId,
      options,
    );
    if (discovery.kind !== "oauth") return;
    if (discovery.authorizationServerUrl !== server.oauthIssuerUrl) {
      await clearMcpOAuthCredentials(dbBinding, server, clock);
      return;
    }

    if (
      server.oauthResourceUri &&
      new URL(server.oauthResourceUri).href !==
        new URL(discovery.resourceUri).href
    ) {
      await clearMcpOAuthCredentials(dbBinding, server, clock);
      return;
    }

    const refreshToken = await decryptToken(
      server.oauthRefreshToken,
      masterSecret,
      saltFor(server.id, "refresh"),
    );
    const clientSecret = server.oauthClientSecret
      ? await decryptToken(
          server.oauthClientSecret,
          masterSecret,
          saltFor(server.id, "client-secret"),
        )
      : undefined;
    const metadata: AuthorizationServerMetadata = {
      ...discovery.metadata,
      token_endpoint_auth_methods_supported: [
        server.oauthTokenEndpointAuthMethod,
      ],
    };
    const tokens = await refreshAuthorization(
      discovery.authorizationServerUrl,
      {
        metadata,
        clientInformation: {
          client_id: server.oauthClientId,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
        },
        refreshToken,
        resource: new URL(discovery.resourceUri),
        fetchFn: createMcpOAuthFetch(env, server.accountId, options),
      },
    );

    const encryptedAccess = await encryptToken(
      tokens.access_token,
      masterSecret,
      saltFor(server.id, "access"),
    );
    const encryptedRefresh = tokens.refresh_token
      ? await encryptToken(
          tokens.refresh_token,
          masterSecret,
          saltFor(server.id, "refresh"),
        )
      : null;
    const tokenExpiresAt =
      tokens.expires_in !== undefined
        ? new Date(clock.now() + tokens.expires_in * 1000).toISOString()
        : null;
    const updateData: Partial<InsertOf<typeof mcpServers>> = {
      oauthAccessToken: encryptedAccess,
      oauthResourceUri: discovery.resourceUri,
      oauthResourceMetadataUrl: discovery.resourceMetadataUrl,
      oauthTokenExpiresAt: tokenExpiresAt,
      updatedAt: new Date(clock.now()).toISOString(),
    };
    if (encryptedRefresh) updateData.oauthRefreshToken = encryptedRefresh;
    await mcpServiceDeps
      .getDb(dbBinding)
      .update(mcpServers)
      .set(updateData)
      .where(eq(mcpServers.id, server.id));
  } catch (error) {
    logError(`Token refresh error for server ${server.id}`, error, {
      module: "mcp",
    });
  }
}

async function clearMcpOAuthCredentials(
  dbBinding: SqlDatabaseBinding,
  server: { id: string; accountId: string; url: string },
  clock: Clock,
): Promise<void> {
  await mcpServiceDeps
    .getDb(dbBinding)
    .update(mcpServers)
    .set({
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthTokenExpiresAt: null,
      updatedAt: new Date(clock.now()).toISOString(),
    })
    .where(
      and(
        eq(mcpServers.id, server.id),
        eq(mcpServers.accountId, server.accountId),
        eq(mcpServers.url, server.url),
        eq(mcpServers.sourceType, "external"),
      ),
    );
}

export async function decryptAccessToken(
  _dbBinding: SqlDatabaseBinding,
  env: Env,
  server: { id: string; oauthAccessToken: string | null },
): Promise<string | null> {
  if (!server.oauthAccessToken || !env.ENCRYPTION_KEY) return null;
  try {
    return await decryptToken(
      server.oauthAccessToken,
      env.ENCRYPTION_KEY,
      saltFor(server.id, "access"),
    );
  } catch {
    return null;
  }
}

// Kept as an explicit export for callers/tests that need the strict default.
export const DEFAULT_MCP_OAUTH_URL_OPTIONS = STRICT_MCP_ENDPOINT_URL_OPTIONS;
