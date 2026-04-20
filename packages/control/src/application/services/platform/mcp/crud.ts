/**
 * MCP Service - CRUD & Managed Server Operations
 *
 * Server listing, creation, update, deletion, external server registration,
 * and managed server reconciliation.
 */

import type { D1Database } from "../../../../shared/types/bindings.ts";
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
  assertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions,
} from "./validation.ts";
import { encryptToken, saltFor } from "./crypto.ts";
import { createMcpOAuthPending, discoverOAuthMetadata } from "./oauth.ts";
import { mcpServiceDeps } from "./oauth.ts";
import {
  listPublications,
  publicationResolvedUrl,
} from "../service-publications.ts";
import { readPublicationAuthSecretRef } from "./auth-secret.ts";

// ---------------------------------------------------------------------------
// Managed server upsert & reconciliation
// ---------------------------------------------------------------------------

export async function upsertManagedMcpServer(
  dbBinding: D1Database,
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
    existing = await db.select({ id: mcpServers.id }).from(mcpServers)
      .where(and(
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.sourceType, "worker"),
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
      conditions.push(
        eq(mcpServers.bundleDeploymentId, params.bundleDeploymentId),
      );
    }
    existing = await db.select({ id: mcpServers.id }).from(mcpServers)
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

  await db.insert(mcpServers).values({
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
    oauthIssuerUrl: authMode === "takos_oidc"
      ? getInternalMcpIssuer(env)
      : null,
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({
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
      oauthIssuerUrl: authMode === "takos_oidc"
        ? getInternalMcpIssuer(env)
        : null,
      enabled: true,
      updatedAt: nowIso,
    },
  });

  const row = await db.select().from(mcpServers).where(
    eq(mcpServers.id, serverId),
  ).get();
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
  const db = mcpServiceDeps.getDb(dbBinding);
  const serviceId = params.serviceId ?? params.workerId;
  if (!serviceId) {
    throw new Error("Managed MCP reconciliation requires a service identifier");
  }
  if (!params.enabled || !params.name || !params.url) {
    await db.delete(mcpServers)
      .where(and(
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.sourceType, "worker"),
        eq(mcpServers.serviceId, serviceId),
      ));
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
  dbBinding: D1Database,
  spaceId: string,
  bundleDeploymentId: string,
): Promise<void> {
  const db = mcpServiceDeps.getDb(dbBinding);
  await db.delete(mcpServers)
    .where(and(
      eq(mcpServers.accountId, spaceId),
      eq(mcpServers.sourceType, "bundle_deployment"),
      eq(mcpServers.bundleDeploymentId, bundleDeploymentId),
    ));
}

// ---------------------------------------------------------------------------
// External server registration (OAuth discovery + fallback)
// ---------------------------------------------------------------------------

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
  assertAllowedMcpEndpointUrl(params.url, urlOptions, "MCP server");

  if (!params.name || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(params.name)) {
    throw new Error(
      "name must start with a letter and contain only letters, digits, underscores, or hyphens (max 64 chars)",
    );
  }

  await assertNoPublishedMcpServerNameCollision(
    dbBinding,
    params.spaceId,
    params.name,
  );

  const db = mcpServiceDeps.getDb(dbBinding);
  const existing = await db.select({
    id: mcpServers.id,
    oauthAccessToken: mcpServers.oauthAccessToken,
  }).from(mcpServers)
    .where(
      and(
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.name, params.name),
      ),
    )
    .get();

  if (existing && existing.oauthAccessToken) {
    return {
      status: "already_registered",
      name: params.name,
      url: params.url,
      message:
        `MCP server "${params.name}" is already registered with an active OAuth token.`,
    };
  }

  try {
    const meta = await discoverOAuthMetadata(params.url, urlOptions);
    const redirectUri = `https://${
      env.ADMIN_DOMAIN || env.TENANT_BASE_DOMAIN || "localhost"
    }/api/mcp/oauth/callback`;
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
      status: "pending_oauth",
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
      transport: "streamable-http",
      sourceType: "external",
      authMode: "oauth_pkce",
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    }).onConflictDoUpdate({
      target: mcpServers.id,
      set: {
        url: params.url,
        transport: "streamable-http",
        sourceType: "external",
        authMode: "oauth_pkce",
        enabled: true,
        updatedAt: nowIso,
      },
    });

    return {
      status: "registered",
      name: params.name,
      url: params.url,
      message:
        `MCP server "${params.name}" registered without OAuth metadata (${
          String(err)
        }).`,
    };
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getMcpServerWithTokens(
  dbBinding: D1Database,
  spaceId: string,
  serverId: string,
): Promise<SelectOf<typeof mcpServers> | null> {
  if (serverId.startsWith("publication:")) {
    const publicationId = serverId.slice("publication:".length);
    const publication = (await listPublications({ DB: dbBinding }, spaceId))
      .find((record) => record.id === publicationId);
    if (!publication || publication.publicationType !== "McpServer") {
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
      enabled: true,
      createdAt: publication.createdAt,
      updatedAt: publication.updatedAt,
    };
    return row;
  }

  const db = mcpServiceDeps.getDb(dbBinding);
  const row = await db.select().from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.accountId, spaceId)))
    .get();
  return row ?? null;
}

export async function listMcpServers(
  dbBinding: D1Database,
  spaceId: string,
): Promise<McpServerRecord[]> {
  const db = mcpServiceDeps.getDb(dbBinding);
  const rows = await db.select().from(mcpServers)
    .where(eq(mcpServers.accountId, spaceId))
    .orderBy(mcpServers.createdAt)
    .all();
  const publicationServers =
    (await listPublications({ DB: dbBinding }, spaceId))
      .filter((record) => record.publicationType === "McpServer")
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
          oauthTokenExpiresAt: null,
          enabled: true,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      })
      .filter((record): record is McpServerRecord => record !== null);
  const legacyServers = rows.map(mapMcpServerRow);
  return [...publicationServers, ...legacyServers];
}

export async function deleteMcpServer(
  dbBinding: D1Database,
  spaceId: string,
  serverId: string,
): Promise<boolean> {
  const db = mcpServiceDeps.getDb(dbBinding);
  const existing = await db.select({
    id: mcpServers.id,
    sourceType: mcpServers.sourceType,
  }).from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.accountId, spaceId)))
    .get();
  if (!existing) return false;
  if (existing.sourceType !== "external") {
    throw new Error(
      "Managed MCP servers must be removed from their source (worker or bundle deployment)",
    );
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
  const db = mcpServiceDeps.getDb(dbBinding);
  const existing = await db.select({
    id: mcpServers.id,
    sourceType: mcpServers.sourceType,
  }).from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.accountId, spaceId)))
    .get();
  if (!existing) return null;
  if (existing.sourceType !== "external" && patch.name !== undefined) {
    throw new Error(
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

  await db.update(mcpServers)
    .set(updateData)
    .where(eq(mcpServers.id, serverId));

  const updated = await db.select().from(mcpServers).where(
    eq(mcpServers.id, serverId),
  ).get();
  return updated ? mapMcpServerRow(updated) : null;
}

async function assertNoPublishedMcpServerNameCollision(
  dbBinding: D1Database,
  spaceId: string,
  name: string,
): Promise<void> {
  const publishedServers = (await listPublications({ DB: dbBinding }, spaceId))
    .filter((record) => record.publicationType === "McpServer");
  if (publishedServers.some((record) => record.name === name)) {
    throw new Error(
      `MCP server "${name}" already exists as a publication in this space`,
    );
  }
}
