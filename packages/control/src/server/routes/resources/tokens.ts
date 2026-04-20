import { Hono } from "hono";
import { z } from "zod";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { BadRequestError } from "takos-common/errors";
import { zValidator } from "../zod-validator.ts";
import {
  getResourceById,
  getResourceByName,
} from "../../../application/services/resources/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { resourceAccessTokens } from "../../../infra/db/schema.ts";
import { and, desc, eq } from "drizzle-orm";
import { base64UrlEncode, generateId } from "../../../shared/utils/index.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { AuthorizationError, NotFoundError } from "takos-common/errors";

function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function parseResourceConfig(config: unknown): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === "string") {
    try {
      return JSON.parse(config) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return typeof config === "object" && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {};
}

function portableConnectionUrl(resource: {
  backend_name?: string | null;
  type: string;
  backing_resource_id?: string | null;
  backing_resource_name?: string | null;
}): string {
  const backend = resource.backend_name || "takos";
  const target = resource.backing_resource_name ||
    resource.backing_resource_id || "";
  return `takos+${resource.type}://${backend}/${target}`;
}

function buildConnectionInfo(resource: {
  id?: string;
  _internal_id?: string;
  type: string;
  backend_name?: string | null;
  backing_resource_id?: string | null;
  backing_resource_name?: string | null;
  config?: unknown;
}): Record<string, string> {
  const connectionInfo: Record<string, string> = {};
  const backendName = resource.backend_name || "cloudflare";
  const config = parseResourceConfig(resource.config);
  const durableConfig =
    typeof config.durableObject === "object" && config.durableObject
      ? config.durableObject as Record<string, unknown>
      : typeof config.durableNamespace === "object" && config.durableNamespace
      ? config.durableNamespace as Record<string, unknown>
      : config;

  switch (resource.type) {
    case "d1":
      connectionInfo.database_id = resource.backing_resource_id || "";
      connectionInfo.database_name = resource.backing_resource_name || "";
      connectionInfo.connection_url = backendName === "cloudflare"
        ? `d1://${resource.backing_resource_id || ""}`
        : portableConnectionUrl(resource);
      break;
    case "r2":
      connectionInfo.bucket_name = resource.backing_resource_name || "";
      connectionInfo.access_url = backendName === "cloudflare"
        ? `https://${
          resource.backing_resource_name || ""
        }.r2.cloudflarestorage.com`
        : portableConnectionUrl(resource);
      break;
    case "kv":
      connectionInfo.namespace_id = resource.backing_resource_id || "";
      connectionInfo.namespace_name = resource.backing_resource_name || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "queue":
      connectionInfo.queue_id = resource.backing_resource_id || "";
      connectionInfo.queue_name = resource.backing_resource_name || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "vectorize":
      connectionInfo.index_name = resource.backing_resource_name || "";
      connectionInfo.index_id = resource.backing_resource_id || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "analyticsEngine":
    case "analytics_engine":
      connectionInfo.dataset = resource.backing_resource_name ||
        resource.backing_resource_id || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "workflow":
      connectionInfo.workflow_name = resource.backing_resource_name ||
        resource.backing_resource_id || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "durableObject":
    case "durable_object":
      connectionInfo.class_name = typeof durableConfig.className === "string"
        ? durableConfig.className
        : "";
      if (typeof durableConfig.scriptName === "string") {
        connectionInfo.script_name = durableConfig.scriptName;
      }
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "secretRef":
      connectionInfo.secret_name = resource.backing_resource_name || "";
      connectionInfo.resource_id = resource.backing_resource_id ||
        resource.id || resource._internal_id || "";
      break;
    default:
      connectionInfo.resource_id = resource.backing_resource_id ||
        resource.id || resource._internal_id || "";
  }

  return connectionInfo;
}

const resourcesTokens = new Hono<AuthenticatedRouteEnv>()
  .get("/:id/tokens", async (c) => {
    const user = c.get("user");
    const resourceId = c.req.param("id");

    const resource = await getResourceById(c.env.DB, resourceId);

    if (!resource) {
      throw new NotFoundError("Resource");
    }

    // Only owner can see tokens
    if (resource.owner_id !== user.id) {
      throw new AuthorizationError("Only the owner can view access tokens");
    }

    const db = getDb(c.env.DB);
    const rows = await db.select({
      id: resourceAccessTokens.id,
      name: resourceAccessTokens.name,
      tokenPrefix: resourceAccessTokens.tokenPrefix,
      permission: resourceAccessTokens.permission,
      expiresAt: resourceAccessTokens.expiresAt,
      lastUsedAt: resourceAccessTokens.lastUsedAt,
      createdAt: resourceAccessTokens.createdAt,
    }).from(resourceAccessTokens)
      .where(eq(resourceAccessTokens.resourceId, resourceId))
      .orderBy(desc(resourceAccessTokens.createdAt))
      .all();

    const tokens = rows.map((t) => ({
      id: t.id,
      name: t.name,
      token_prefix: t.tokenPrefix,
      permission: t.permission,
      expires_at: t.expiresAt,
      last_used_at: t.lastUsedAt,
      created_at: t.createdAt,
    }));
    return c.json({ tokens });
  })
  .get("/by-name/:name/tokens", async (c) => {
    const user = c.get("user");
    const resourceName = c.req.param("name");

    const resource = await getResourceByName(c.env.DB, user.id, resourceName);
    const resourceId = (resource as { _internal_id?: string } | null)
      ?._internal_id;

    if (!resource || !resourceId) {
      throw new NotFoundError("Resource");
    }

    const db = getDb(c.env.DB);
    const rows = await db.select({
      id: resourceAccessTokens.id,
      name: resourceAccessTokens.name,
      tokenPrefix: resourceAccessTokens.tokenPrefix,
      permission: resourceAccessTokens.permission,
      expiresAt: resourceAccessTokens.expiresAt,
      lastUsedAt: resourceAccessTokens.lastUsedAt,
      createdAt: resourceAccessTokens.createdAt,
    }).from(resourceAccessTokens)
      .where(eq(resourceAccessTokens.resourceId, resourceId))
      .orderBy(desc(resourceAccessTokens.createdAt))
      .all();

    const tokens = rows.map((t) => ({
      id: t.id,
      name: t.name,
      token_prefix: t.tokenPrefix,
      permission: t.permission,
      expires_at: t.expiresAt,
      last_used_at: t.lastUsedAt,
      created_at: t.createdAt,
    }));
    return c.json({ tokens });
  })
  .post(
    "/:id/tokens",
    zValidator(
      "json",
      z.object({
        name: z.string(),
        permission: z.enum(["read", "write"]).optional(),
        expires_in_days: z.number().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const resourceId = c.req.param("id");
      const body = c.req.valid("json");

      if (!body.name?.trim()) {
        throw new BadRequestError("Token name is required");
      }

      const resource = await getResourceById(c.env.DB, resourceId);

      if (!resource) {
        throw new NotFoundError("Resource");
      }

      if (resource.owner_id !== user.id) {
        throw new AuthorizationError("Only the owner can create access tokens");
      }

      const tokenBytes = generateRandomBytes(32);
      const tokenPlain = `tak_${base64UrlEncode(tokenBytes)}`;
      const tokenHash = await computeSHA256(tokenPlain);
      const tokenPrefix = tokenPlain.substring(0, 12);

      let expiresAt: string | null = null;
      if (body.expires_in_days && body.expires_in_days > 0) {
        const expires = new Date();
        expires.setDate(expires.getDate() + body.expires_in_days);
        expiresAt = expires.toISOString();
      }

      const id = generateId();
      const timestamp = new Date().toISOString();

      const db = getDb(c.env.DB);
      await db.insert(resourceAccessTokens).values({
        id,
        resourceId,
        name: body.name.trim(),
        tokenHash,
        tokenPrefix,
        permission: body.permission || "read",
        expiresAt,
        createdBy: user.id,
        createdAt: timestamp,
      });

      return c.json({
        token: {
          id,
          name: body.name.trim(),
          token: tokenPlain, // Only returned on creation
          token_prefix: tokenPrefix,
          permission: body.permission || "read",
          expires_at: expiresAt,
          created_at: timestamp,
        },
      }, 201);
    },
  )
  .post(
    "/by-name/:name/tokens",
    zValidator(
      "json",
      z.object({
        name: z.string(),
        permission: z.enum(["read", "write"]).optional(),
        expires_in_days: z.number().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const resourceName = c.req.param("name");
      const body = c.req.valid("json");

      if (!body.name?.trim()) {
        throw new BadRequestError("Token name is required");
      }

      const resource = await getResourceByName(c.env.DB, user.id, resourceName);
      const resourceId = (resource as { _internal_id?: string } | null)
        ?._internal_id;

      if (!resource || !resourceId) {
        throw new NotFoundError("Resource");
      }

      const tokenBytes = generateRandomBytes(32);
      const tokenPlain = `tak_${base64UrlEncode(tokenBytes)}`;
      const tokenHash = await computeSHA256(tokenPlain);
      const tokenPrefix = tokenPlain.substring(0, 12);

      let expiresAt: string | null = null;
      if (body.expires_in_days && body.expires_in_days > 0) {
        const expires = new Date();
        expires.setDate(expires.getDate() + body.expires_in_days);
        expiresAt = expires.toISOString();
      }

      const id = generateId();
      const timestamp = new Date().toISOString();

      const db = getDb(c.env.DB);
      await db.insert(resourceAccessTokens).values({
        id,
        resourceId,
        name: body.name.trim(),
        tokenHash,
        tokenPrefix,
        permission: body.permission || "read",
        expiresAt,
        createdBy: user.id,
        createdAt: timestamp,
      });

      return c.json({
        token: {
          id,
          name: body.name.trim(),
          token: tokenPlain,
          token_prefix: tokenPrefix,
          permission: body.permission || "read",
          expires_at: expiresAt,
          created_at: timestamp,
        },
      }, 201);
    },
  )
  .delete("/:id/tokens/:tokenId", async (c) => {
    const user = c.get("user");
    const resourceId = c.req.param("id");
    const tokenId = c.req.param("tokenId");

    const resource = await getResourceById(c.env.DB, resourceId);

    if (!resource) {
      throw new NotFoundError("Resource");
    }

    if (resource.owner_id !== user.id) {
      throw new AuthorizationError("Only the owner can delete access tokens");
    }

    const db = getDb(c.env.DB);

    const token = await db.select().from(resourceAccessTokens).where(
      and(
        eq(resourceAccessTokens.id, tokenId),
        eq(resourceAccessTokens.resourceId, resourceId),
      ),
    ).get();

    if (!token) {
      throw new NotFoundError("Token");
    }

    await db.delete(resourceAccessTokens).where(
      eq(resourceAccessTokens.id, tokenId),
    );

    return c.json({ success: true });
  })
  .delete("/by-name/:name/tokens/:tokenId", async (c) => {
    const user = c.get("user");
    const resourceName = c.req.param("name");
    const tokenId = c.req.param("tokenId");

    const resource = await getResourceByName(c.env.DB, user.id, resourceName);
    const resourceId = (resource as { _internal_id?: string } | null)
      ?._internal_id;

    if (!resource || !resourceId) {
      throw new NotFoundError("Resource");
    }

    const db = getDb(c.env.DB);

    const token = await db.select().from(resourceAccessTokens).where(
      and(
        eq(resourceAccessTokens.id, tokenId),
        eq(resourceAccessTokens.resourceId, resourceId),
      ),
    ).get();

    if (!token) {
      throw new NotFoundError("Token");
    }

    await db.delete(resourceAccessTokens).where(
      eq(resourceAccessTokens.id, tokenId),
    );

    return c.json({ success: true });
  })
  .get("/:id/connection", async (c) => {
    const user = c.get("user");
    const resourceId = c.req.param("id");

    const resource = await getResourceById(c.env.DB, resourceId);

    if (!resource) {
      throw new NotFoundError("Resource");
    }

    if (resource.owner_id !== user.id) {
      throw new AuthorizationError("Only the owner can view connection info");
    }

    return c.json({
      type: resource.type,
      name: resource.name,
      status: resource.status,
      connection: buildConnectionInfo(resource),
    });
  })
  .get("/by-name/:name/connection", async (c) => {
    const user = c.get("user");
    const resourceName = c.req.param("name");

    const resource = await getResourceByName(c.env.DB, user.id, resourceName);

    if (!resource) {
      throw new NotFoundError("Resource");
    }

    return c.json({
      type: resource.type,
      name: resource.name,
      status: resource.status,
      connection: buildConnectionInfo(resource),
    });
  });

export default resourcesTokens;
