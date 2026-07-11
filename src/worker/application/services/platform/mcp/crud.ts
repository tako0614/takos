/**
 * MCP Service - CRUD & Managed Server Operations
 *
 * Server listing, creation, update, deletion, external server registration,
 * and managed server reconciliation.
 */

import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import type {
  InsertOf,
  SelectOf,
} from "../../../../shared/types/drizzle-utils.ts";
import { mcpServers } from "../../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { generateId } from "../../../../shared/utils/index.ts";
import type { Env } from "../../../../shared/types/index.ts";
import type {
  McpIssuerEnv,
  McpServerRecord,
  RegisterExternalMcpServerResult,
} from "./mcp-models.ts";
import { getInternalMcpIssuer, mapMcpServerRow } from "./mcp-models.ts";
import {
  getMcpEndpointUrlOptions,
  normalizeMcpEndpointUrl,
} from "./validation.ts";
import { encryptToken, saltFor } from "./crypto.ts";
import { beginMcpAuthorization, mcpServiceDeps } from "./oauth.ts";
import {
  isPublicationType,
  listPublications,
  publicationResolvedUrl,
  RUNTIME_PROJECTION_CAPABILITIES,
} from "../service-publications.ts";
import {
  readPublicationAuthSecretRef,
  resolvePublicationAuthToken,
} from "./auth-secret.ts";
import {
  BadRequestError,
  ConflictError,
} from "@takos/worker-platform-utils/errors";

// ---------------------------------------------------------------------------
// Managed server upsert & reconciliation
// ---------------------------------------------------------------------------

export async function upsertManagedMcpServer(
  dbBinding: SqlDatabaseBinding,
  env: McpIssuerEnv & { ENCRYPTION_KEY?: string },
  params: {
    spaceId: string;
    name: string;
    url: string;
    sourceType: "worker" | "bundle_deployment";
    serviceId?: string | null;
    workerId?: string | null;
    bundleDeploymentId?: string | null;
    /** Pre-shared Bearer token for authMode='bearer_token'. */
    authToken?: string;
  },
): Promise<McpServerRecord> {
  const db = mcpServiceDeps.getDb(dbBinding);
  const nowIso = new Date().toISOString();
  const serviceId = params.serviceId ?? params.workerId ?? null;

  let existing: { id: string } | undefined;
  if (params.sourceType === "worker" && serviceId) {
    existing = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.accountId, params.spaceId),
          eq(mcpServers.sourceType, "worker"),
          eq(mcpServers.serviceId, serviceId),
        ),
      )
      .get();
  } else {
    const conditions = [
      eq(mcpServers.accountId, params.spaceId),
      eq(mcpServers.name, params.name),
      eq(mcpServers.sourceType, params.sourceType),
    ];
    if (params.bundleDeploymentId) {
      conditions.push(
        eq(mcpServers.bundleDeploymentId, params.bundleDeploymentId),
      );
    }
    existing = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(and(...conditions))
      .get();
  }

  const serverId = existing?.id ?? generateId(16);
  const authMode = params.authToken ? "bearer_token" : "takos_oidc";

  // Encrypt the Bearer token if provided
  let encryptedAccessToken: string | null = null;
  if (params.authToken && env.ENCRYPTION_KEY) {
    encryptedAccessToken = await encryptToken(
      params.authToken,
      env.ENCRYPTION_KEY,
      saltFor(serverId, "access"),
    );
  }

  await db
    .insert(mcpServers)
    .values({
      id: serverId,
      accountId: params.spaceId,
      name: params.name,
      url: params.url,
      transport: "streamable-http",
      sourceType: params.sourceType,
      authMode,
      serviceId,
      bundleDeploymentId: params.bundleDeploymentId ?? null,
      oauthAccessToken: encryptedAccessToken,
      oauthIssuerUrl:
        authMode === "takos_oidc" ? getInternalMcpIssuer(env) : null,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: mcpServers.id,
      set: {
        name: params.name,
        url: params.url,
        transport: "streamable-http",
        sourceType: params.sourceType,
        authMode,
        serviceId,
        bundleDeploymentId: params.bundleDeploymentId ?? null,
        oauthAccessToken: encryptedAccessToken,
        oauthRefreshToken: null,
        oauthTokenExpiresAt: null,
        oauthScope: null,
        oauthIssuerUrl:
          authMode === "takos_oidc" ? getInternalMcpIssuer(env) : null,
        oauthResourceUri: null,
        oauthResourceMetadataUrl: null,
        oauthClientId: null,
        oauthClientSecret: null,
        oauthClientIdIssuedAt: null,
        oauthClientSecretExpiresAt: null,
        oauthRegistrationMode: null,
        oauthTokenEndpointAuthMethod: null,
        enabled: true,
        updatedAt: nowIso,
      },
    });

  const row = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId))
    .get();
  if (!row) {
    throw new Error(
      `mcp server upsert invariant violated: row ${serverId} not found after upsert`,
    );
  }
  return mapMcpServerRow(row);
}

export async function reconcileManagedWorkerMcpServer(
  dbBinding: SqlDatabaseBinding,
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
  const db = mcpServiceDeps.getDb(dbBinding);
  const serviceId = params.serviceId ?? params.workerId;
  if (!serviceId) {
    throw new Error("Managed MCP reconciliation requires a service identifier");
  }
  if (!params.enabled || !params.name || !params.url) {
    await db
      .delete(mcpServers)
      .where(
        and(
          eq(mcpServers.accountId, params.spaceId),
          eq(mcpServers.sourceType, "worker"),
          eq(mcpServers.serviceId, serviceId),
        ),
      );
    return;
  }

  await upsertManagedMcpServer(dbBinding, env, {
    spaceId: params.spaceId,
    sourceType: "worker",
    serviceId,
    name: params.name,
    url: params.url,
  });
}

export async function deleteManagedMcpServersByBundleDeployment(
  dbBinding: SqlDatabaseBinding,
  spaceId: string,
  bundleDeploymentId: string,
): Promise<void> {
  const db = mcpServiceDeps.getDb(dbBinding);
  await db
    .delete(mcpServers)
    .where(
      and(
        eq(mcpServers.accountId, spaceId),
        eq(mcpServers.sourceType, "bundle_deployment"),
        eq(mcpServers.bundleDeploymentId, bundleDeploymentId),
      ),
    );
}

// ---------------------------------------------------------------------------
// External server registration (OAuth discovery + fallback)
// ---------------------------------------------------------------------------

export async function registerExternalMcpServer(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  params: {
    spaceId: string;
    initiatorUserId: string;
    name: string;
    url: string;
    scope?: string;
  },
): Promise<RegisterExternalMcpServerResult> {
  const urlOptions = getMcpEndpointUrlOptions(env);
  const normalizedRequestedUrl = normalizeMcpEndpointUrl(
    params.url,
    urlOptions,
    "MCP server",
  );

  if (!params.name || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(params.name)) {
    throw new BadRequestError(
      "name must start with a letter and contain only letters, digits, underscores, or hyphens (max 64 chars)",
    );
  }

  await assertNoPublishedMcpServerNameCollision(
    dbBinding,
    params.spaceId,
    params.name,
  );

  const db = mcpServiceDeps.getDb(dbBinding);
  const existing = await db
    .select({
      id: mcpServers.id,
      url: mcpServers.url,
      sourceType: mcpServers.sourceType,
      oauthAccessToken: mcpServers.oauthAccessToken,
    })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.name, params.name),
      ),
    )
    .get();

  if (existing?.sourceType && existing.sourceType !== "external") {
    throw new ConflictError(
      `MCP server "${params.name}" is managed by another source in this Workspace`,
    );
  }

  if (
    existing &&
    normalizeMcpEndpointUrl(existing.url, urlOptions, "Existing MCP server") !==
      normalizedRequestedUrl
  ) {
    throw new ConflictError(
      `MCP server "${params.name}" is already bound to a different endpoint`,
    );
  }

  // Preserve the exact stored spelling for an existing row. OAuth pending
  // state carries this value into the callback, which then uses exact
  // workspace + name + URL matching before attaching credentials.
  const serverUrl = existing?.url ?? normalizedRequestedUrl;

  if (existing && existing.oauthAccessToken) {
    return {
      status: "already_registered",
      name: params.name,
      url: serverUrl,
      message: `MCP server "${params.name}" is already registered for this endpoint with an active OAuth token.`,
    };
  }

  const authorization = await beginMcpAuthorization(dbBinding, env, {
    spaceId: params.spaceId,
    initiatorUserId: params.initiatorUserId,
    serverName: params.name,
    serverUrl,
    scope: params.scope,
  });
  if (authorization.kind === "oauth") {
    return {
      status: "pending_oauth",
      name: params.name,
      url: serverUrl,
      authUrl: authorization.authUrl,
      message: `Authorize MCP server "${params.name}" to finish registration.`,
    };
  }

  const nowIso = new Date().toISOString();
  const serverId = existing?.id ?? generateId(16);
  await db
    .insert(mcpServers)
    .values({
      id: serverId,
      accountId: params.spaceId,
      name: params.name,
      url: serverUrl,
      transport: "streamable-http",
      sourceType: "external",
      authMode: "none",
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: mcpServers.id,
      set: {
        url: serverUrl,
        transport: "streamable-http",
        sourceType: "external",
        authMode: "none",
        oauthAccessToken: null,
        oauthRefreshToken: null,
        oauthTokenExpiresAt: null,
        oauthScope: null,
        oauthIssuerUrl: null,
        oauthResourceUri: null,
        oauthResourceMetadataUrl: null,
        oauthClientId: null,
        oauthClientSecret: null,
        oauthClientIdIssuedAt: null,
        oauthClientSecretExpiresAt: null,
        oauthRegistrationMode: null,
        oauthTokenEndpointAuthMethod: null,
        enabled: true,
        updatedAt: nowIso,
      },
    });
  return {
    status: "registered",
    name: params.name,
    url: serverUrl,
    message: `Public MCP server "${params.name}" registered without authorization.`,
  };
}

/**
 * Re-initiate the OAuth flow for an already-registered external MCP server whose
 * token has expired and cannot be silently refreshed (no/expired refresh token).
 * Unlike {@link registerExternalMcpServer}, this always mints a fresh pending
 * authorization regardless of any stale stored token.
 */
export async function reauthorizeExternalMcpServer(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  params: { spaceId: string; serverId: string; initiatorUserId: string },
): Promise<RegisterExternalMcpServerResult> {
  const server = await getMcpServerWithTokens(
    dbBinding,
    params.spaceId,
    params.serverId,
  );
  if (!server || server.sourceType !== "external") {
    throw new BadRequestError("MCP server not found");
  }
  const result = await beginMcpAuthorization(dbBinding, env, {
    spaceId: params.spaceId,
    initiatorUserId: params.initiatorUserId,
    serverName: server.name,
    serverUrl: server.url,
    scope: server.oauthScope ?? undefined,
    existingClient: {
      serverId: server.id,
      issuerUrl: server.oauthIssuerUrl,
      clientId: server.oauthClientId,
      encryptedClientSecret: server.oauthClientSecret,
      clientIdIssuedAt: server.oauthClientIdIssuedAt,
      clientSecretExpiresAt: server.oauthClientSecretExpiresAt,
      registrationMode: server.oauthRegistrationMode,
      tokenEndpointAuthMethod: server.oauthTokenEndpointAuthMethod,
    },
  });
  if (result.kind === "public") {
    const nowIso = new Date().toISOString();
    await mcpServiceDeps
      .getDb(dbBinding)
      .update(mcpServers)
      .set({
        authMode: "none",
        oauthAccessToken: null,
        oauthRefreshToken: null,
        oauthTokenExpiresAt: null,
        oauthScope: null,
        oauthIssuerUrl: null,
        oauthResourceUri: null,
        oauthResourceMetadataUrl: null,
        oauthClientId: null,
        oauthClientSecret: null,
        oauthClientIdIssuedAt: null,
        oauthClientSecretExpiresAt: null,
        oauthRegistrationMode: null,
        oauthTokenEndpointAuthMethod: null,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(mcpServers.id, server.id),
          eq(mcpServers.accountId, params.spaceId),
          eq(mcpServers.url, server.url),
          eq(mcpServers.sourceType, "external"),
        ),
      );
    return {
      status: "registered",
      name: server.name,
      url: server.url,
      message: `Public MCP server "${server.name}" no longer requires authorization.`,
    };
  }

  return {
    status: "pending_oauth",
    name: server.name,
    url: server.url,
    authUrl: result.authUrl,
    message: `Re-authorize MCP server "${server.name}" to refresh access.`,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getMcpServerWithTokens(
  dbBinding: SqlDatabaseBinding,
  spaceId: string,
  serverId: string,
): Promise<SelectOf<typeof mcpServers> | null> {
  if (serverId.startsWith("publication:")) {
    const publicationId = serverId.slice("publication:".length);
    const publication = (
      await listPublications({ DB: dbBinding }, spaceId)
    ).find((record) => record.id === publicationId);
    if (
      !publication ||
      !isPublicationType(
        publication.publicationType,
        RUNTIME_PROJECTION_CAPABILITIES.mcpServer,
      )
    ) {
      return null;
    }
    const url = publicationResolvedUrl(publication);
    if (!url) return null;
    const authSecretRef = readPublicationAuthSecretRef(publication);
    const row: SelectOf<typeof mcpServers> = {
      id: serverId,
      accountId: spaceId,
      name: publication.name,
      url,
      transport: "streamable-http",
      sourceType: "publication",
      authMode: authSecretRef ? "bearer_token" : "takos_oidc",
      serviceId: publication.ownerServiceId,
      bundleDeploymentId: null,
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthTokenExpiresAt: null,
      oauthScope: null,
      oauthIssuerUrl: null,
      oauthResourceUri: null,
      oauthResourceMetadataUrl: null,
      oauthClientId: null,
      oauthClientSecret: null,
      oauthClientIdIssuedAt: null,
      oauthClientSecretExpiresAt: null,
      oauthRegistrationMode: null,
      oauthTokenEndpointAuthMethod: null,
      enabled: true,
      createdAt: publication.createdAt,
      updatedAt: publication.updatedAt,
    };
    return row;
  }

  const db = mcpServiceDeps.getDb(dbBinding);
  const row = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.accountId, spaceId)))
    .get();
  return row ?? null;
}

export async function resolvePublicationMcpServerAccessToken(
  dbBinding: SqlDatabaseBinding,
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: { spaceId: string; serverId: string },
): Promise<string | null> {
  if (!params.serverId.startsWith("publication:")) return null;
  const publicationId = params.serverId.slice("publication:".length);
  const publication = (
    await listPublications({ DB: dbBinding }, params.spaceId)
  ).find((record) => record.id === publicationId);
  if (
    !publication ||
    !isPublicationType(
      publication.publicationType,
      RUNTIME_PROJECTION_CAPABILITIES.mcpServer,
    )
  ) {
    return null;
  }
  const authSecretRef = readPublicationAuthSecretRef(publication);
  return await resolvePublicationAuthToken(dbBinding, env, {
    spaceId: params.spaceId,
    publicationName: publication.name,
    ownerServiceId: publication.ownerServiceId,
    authSecretRef,
  });
}

export async function listMcpServers(
  dbBinding: SqlDatabaseBinding,
  spaceId: string,
): Promise<McpServerRecord[]> {
  const db = mcpServiceDeps.getDb(dbBinding);
  const rows = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.accountId, spaceId))
    .orderBy(mcpServers.createdAt)
    .all();
  const publicationServers = (
    await listPublications({ DB: dbBinding }, spaceId)
  )
    .filter((record) =>
      isPublicationType(
        record.publicationType,
        RUNTIME_PROJECTION_CAPABILITIES.mcpServer,
      ),
    )
    .map((record): McpServerRecord | null => {
      const url = publicationResolvedUrl(record);
      if (!url) return null;
      const authSecretRef = readPublicationAuthSecretRef(record);
      return {
        id: `publication:${record.id}`,
        spaceId,
        name: record.name,
        url,
        transport: "streamable-http",
        sourceType: "publication",
        authMode: authSecretRef ? "bearer_token" : "takos_oidc",
        serviceId: record.ownerServiceId,
        bundleDeploymentId: null,
        oauthScope: null,
        oauthIssuerUrl: null,
        oauthRegistrationMode: null,
        oauthTokenExpiresAt: null,
        authorizationStatus: "managed",
        enabled: true,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    })
    .filter((record): record is McpServerRecord => record !== null);
  const configuredServers = rows.map(mapMcpServerRow);
  return [...publicationServers, ...configuredServers];
}

export async function deleteMcpServer(
  dbBinding: SqlDatabaseBinding,
  spaceId: string,
  serverId: string,
): Promise<boolean> {
  const db = mcpServiceDeps.getDb(dbBinding);
  const existing = await db
    .select({
      id: mcpServers.id,
      sourceType: mcpServers.sourceType,
    })
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.accountId, spaceId)))
    .get();
  if (!existing) return false;
  if (existing.sourceType !== "external") {
    throw new BadRequestError(
      "Managed MCP servers must be removed from their source (worker or bundle deployment)",
    );
  }
  await db.delete(mcpServers).where(eq(mcpServers.id, serverId));
  return true;
}

export async function updateMcpServer(
  dbBinding: SqlDatabaseBinding,
  spaceId: string,
  serverId: string,
  patch: { enabled?: boolean; name?: string },
): Promise<McpServerRecord | null> {
  const db = mcpServiceDeps.getDb(dbBinding);
  const existing = await db
    .select({
      id: mcpServers.id,
      sourceType: mcpServers.sourceType,
    })
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.accountId, spaceId)))
    .get();
  if (!existing) return null;
  if (existing.sourceType !== "external" && patch.name !== undefined) {
    throw new BadRequestError(
      "Managed MCP server names are controlled by their source declaration",
    );
  }
  if (patch.name !== undefined) {
    await assertNoPublishedMcpServerNameCollision(
      dbBinding,
      spaceId,
      patch.name,
    );
  }

  const updateData: Partial<InsertOf<typeof mcpServers>> = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.enabled !== undefined) updateData.enabled = patch.enabled;
  if (patch.name !== undefined) updateData.name = patch.name;

  await db
    .update(mcpServers)
    .set(updateData)
    .where(eq(mcpServers.id, serverId));

  const updated = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId))
    .get();
  return updated ? mapMcpServerRow(updated) : null;
}

async function assertNoPublishedMcpServerNameCollision(
  dbBinding: SqlDatabaseBinding,
  spaceId: string,
  name: string,
): Promise<void> {
  const publishedServers = (
    await listPublications({ DB: dbBinding }, spaceId)
  ).filter((record) =>
    isPublicationType(
      record.publicationType,
      RUNTIME_PROJECTION_CAPABILITIES.mcpServer,
    ),
  );
  if (publishedServers.some((record) => record.name === name)) {
    throw new ConflictError(
      `MCP server "${name}" already exists as a publication in this space`,
    );
  }
}
