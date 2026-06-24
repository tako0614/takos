import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  Resource,
  ResourcePermission,
} from "../../../shared/types/index.ts";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { BadRequestError } from "@takos/worker-platform-utils/errors";
import { zValidator } from "../zod-validator.ts";
import { createOptionalCloudflareWfpBackend } from "../../../platform/backends/cloudflare/wfp.ts";
import {
  getPortableObjectStore,
  isPortableResourceBackend,
} from "./portable-runtime.ts";
import { checkResourceAccess } from "../../../application/services/resources/index.ts";
import {
  AuthorizationError,
  InternalError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import { getDb } from "../../../infra/db/index.ts";
import { resources } from "../../../infra/db/schema.ts";
import { and, eq, inArray } from "drizzle-orm";
import { logError } from "../../../shared/utils/logger.ts";
import {
  base64ToBytes,
  bytesToBase64,
} from "../../../shared/utils/encoding-utils.ts";
import { getResourceTypeQueryValues } from "../../../application/services/resources/capabilities.ts";
import { toResource } from "./route-internals.ts";
import type {
  ObjectStoreBinding,
  ObjectStoreObject,
  ObjectStoreObjectBody,
} from "../../../shared/types/bindings.ts";


function requireResourceId(c: Context<AuthenticatedRouteEnv>): string {
  const resourceId = c.req.param("id");
  if (!resourceId) {
    throw new BadRequestError("Resource ID is required");
  }
  return resourceId;
}

function requireObjectKey(c: Context<AuthenticatedRouteEnv>): string {
  const key = c.req.param("key");
  if (!key) {
    throw new BadRequestError("Object key is required");
  }
  return decodeURIComponent(key);
}

async function loadObjectStoreResource(
  c: Context<AuthenticatedRouteEnv>,
  resourceId: string,
  requiredPermissions?: ResourcePermission[],
): Promise<Resource> {
  const db = getDb(c.env.DB);
  const resourceData = await db.select().from(resources).where(
    and(
      eq(resources.id, resourceId),
      inArray(resources.type, getResourceTypeQueryValues("object-store")),
    ),
  ).get();

  if (!resourceData) {
    throw new NotFoundError("object store resource");
  }

  const resource = toResource(resourceData);
  const user = c.get("user");
  const hasAccess = resource.owner_id === user.id ||
    await checkResourceAccess(
      c.env.DB,
      resourceId,
      user.id,
      requiredPermissions,
    );
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  return resource;
}

async function listAllObjects(bucket: ObjectStoreBinding) {
  const objects: ObjectStoreObject[] = [];
  let cursor: string | undefined;

  do {
    const page = await bucket.list({ limit: 1000, cursor });
    objects.push(...(page.objects ?? []));
    cursor = page.truncated && "cursor" in page ? page.cursor : undefined;
  } while (cursor);

  return objects;
}

function getR2ListCursor(
  result: Awaited<ReturnType<ObjectStoreBinding["list"]>>,
): string | null {
  return result.truncated && "cursor" in result ? result.cursor ?? null : null;
}

function getPortableObjectContentType(
  object: ObjectStoreObjectBody,
): string | null {
  const metadata = object.httpMetadata;
  if (metadata && typeof metadata === "object" && "contentType" in metadata) {
    const contentType = metadata.contentType;
    return typeof contentType === "string" ? contentType : null;
  }
  if (typeof object.writeHttpMetadata === "function") {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    return headers.get("content-type");
  }
  return null;
}

const listObjectsValidator = zValidator(
  "query",
  z.object({
    prefix: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.string().optional(),
  }),
);

async function listObjectsHandler(c: Context<AuthenticatedRouteEnv>) {
  const resource = await loadObjectStoreResource(c, requireResourceId(c));

  const prefix = c.req.query("prefix") || undefined;
  const cursor = c.req.query("cursor") || undefined;
  const { limit } = parsePagination(c.req.query(), {
    limit: 100,
    maxLimit: 1000,
  });

  if (isPortableResourceBackend(resource.backend_name)) {
    try {
      const bucket = getPortableObjectStore(resource);
      const result = await bucket.list({
        prefix,
        cursor,
        limit,
      });
      return c.json({
        objects: result.objects ?? [],
        truncated: result.truncated ?? false,
        cursor: getR2ListCursor(result),
      });
    } catch (err) {
      logError("Failed to list portable objects", err, {
        module: "routes/resources/r2",
      });
      throw new InternalError("Failed to list objects");
    }
  }

  if (!resource.backing_resource_name) {
    throw new BadRequestError("object store not provisioned");
  }

  try {
    const wfp = createOptionalCloudflareWfpBackend(c.env);
    if (!wfp) {
      throw new InternalError("platform backend not configured");
    }
    const result = await wfp.r2.listR2Objects(
      resource.backing_resource_name,
      {
        prefix,
        cursor,
        limit,
      },
    );

    return c.json({
      objects: result.objects,
      truncated: result.truncated,
      cursor: result.cursor,
    });
  } catch (err) {
    logError("Failed to list objects", err, {
      module: "routes/resources/r2",
    });
    throw new InternalError("Failed to list objects");
  }
}

async function objectStatsHandler(c: Context<AuthenticatedRouteEnv>) {
  const resource = await loadObjectStoreResource(c, requireResourceId(c));

  if (isPortableResourceBackend(resource.backend_name)) {
    try {
      const bucket = getPortableObjectStore(resource);
      const objects = await listAllObjects(bucket);
      const size_bytes = objects.reduce(
        (sum, object) => sum + Number((object.size as number | undefined) ?? 0),
        0,
      );
      return c.json({
        stats: {
          object_count: objects.length,
          size_bytes,
        },
      });
    } catch (err) {
      logError("Failed to get portable object stats", err, {
        module: "routes/resources/r2",
      });
      throw new InternalError("Failed to get stats");
    }
  }

  if (!resource.backing_resource_name) {
    throw new BadRequestError("object store not provisioned");
  }

  try {
    const wfp = createOptionalCloudflareWfpBackend(c.env);
    if (!wfp) {
      throw new InternalError("platform backend not configured");
    }
    const stats = await wfp.r2.getR2BucketStats(
      resource.backing_resource_name,
    );

    return c.json({ stats });
  } catch (err) {
    logError("Failed to get object store stats", err, {
      module: "routes/resources/r2",
    });
    throw new InternalError("Failed to get stats");
  }
}

/**
 * Encode raw object bytes for the JSON transport. Valid UTF-8 is returned as
 * text (readable, smaller); anything else (images, archives, ...) is returned
 * as base64 so binary objects round-trip without corruption.
 */
function encodeObjectBody(
  bytes: Uint8Array,
): { value: string; encoding: "utf8" | "base64" } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { value: text, encoding: "utf8" };
  } catch {
    return { value: bytesToBase64(bytes), encoding: "base64" };
  }
}

async function getObjectHandler(c: Context<AuthenticatedRouteEnv>) {
  const resource = await loadObjectStoreResource(c, requireResourceId(c));
  const key = requireObjectKey(c);

  if (isPortableResourceBackend(resource.backend_name)) {
    try {
      const bucket = getPortableObjectStore(resource);
      const object = await bucket.get(key);
      if (!object) {
        throw new NotFoundError("Object");
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      return c.json({
        key,
        ...encodeObjectBody(bytes),
        content_type: getPortableObjectContentType(object),
        size: object.size,
      });
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      logError("Failed to read portable object", err, {
        module: "routes/resources/r2",
      });
      throw new InternalError("Failed to read object");
    }
  }

  if (!resource.backing_resource_name) {
    throw new BadRequestError("object store not provisioned");
  }

  try {
    const wfp = createOptionalCloudflareWfpBackend(c.env);
    if (!wfp) {
      throw new InternalError("platform backend not configured");
    }
    const object = await wfp.r2.getR2Object(
      resource.backing_resource_name,
      key,
    );
    if (!object) {
      throw new NotFoundError("Object");
    }
    return c.json({
      key,
      ...encodeObjectBody(new Uint8Array(object.body)),
      content_type: object.contentType,
      size: object.size,
    });
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    logError("Failed to read object", err, {
      module: "routes/resources/r2",
    });
    throw new InternalError("Failed to read object");
  }
}

const putObjectValidator = zValidator(
  "json",
  z.object({
    value: z.string(),
    // "base64" decodes `value` to raw bytes before storing (binary-safe);
    // "utf8" (default) stores `value` as a text body.
    encoding: z.enum(["utf8", "base64"]).optional(),
    content_type: z.string().optional(),
  }),
);

async function putObjectHandler(c: Context<AuthenticatedRouteEnv>) {
  const resource = await loadObjectStoreResource(c, requireResourceId(c), [
    "write",
    "admin",
  ]);
  const key = requireObjectKey(c);
  const body = c.req.valid("json" as never) as {
    value: string;
    encoding?: "utf8" | "base64";
    content_type?: string;
  };
  const payload: ArrayBuffer | string = body.encoding === "base64"
    ? (base64ToBytes(body.value).buffer as ArrayBuffer)
    : body.value;

  if (isPortableResourceBackend(resource.backend_name)) {
    try {
      const bucket = getPortableObjectStore(resource);
      await bucket.put(key, payload, {
        ...(body.content_type
          ? { httpMetadata: { contentType: body.content_type } }
          : {}),
      });
      return c.json({ success: true });
    } catch (err) {
      logError("Failed to write portable object", err, {
        module: "routes/resources/r2",
      });
      throw new InternalError("Failed to store object");
    }
  }

  if (!resource.backing_resource_name) {
    throw new BadRequestError("object store not provisioned");
  }

  try {
    const wfp = createOptionalCloudflareWfpBackend(c.env);
    if (!wfp) {
      throw new InternalError("platform backend not configured");
    }
    await wfp.r2.uploadToR2(
      resource.backing_resource_name,
      key,
      payload,
      {
        contentType: body.content_type,
      },
    );
    return c.json({ success: true });
  } catch (err) {
    logError("Failed to write object", err, {
      module: "routes/resources/r2",
    });
    throw new InternalError("Failed to store object");
  }
}

async function deleteObjectHandler(c: Context<AuthenticatedRouteEnv>) {
  const resource = await loadObjectStoreResource(c, requireResourceId(c), [
    "write",
    "admin",
  ]);
  const key = requireObjectKey(c);

  if (isPortableResourceBackend(resource.backend_name)) {
    try {
      const bucket = getPortableObjectStore(resource);
      await bucket.delete(key);
      return c.json({ success: true });
    } catch (err) {
      logError("Failed to delete portable object", err, {
        module: "routes/resources/r2",
      });
      throw new InternalError("Failed to delete object");
    }
  }

  if (!resource.backing_resource_name) {
    throw new BadRequestError("object store not provisioned");
  }

  try {
    const wfp = createOptionalCloudflareWfpBackend(c.env);
    if (!wfp) {
      throw new InternalError("platform backend not configured");
    }
    await wfp.r2.deleteR2Object(resource.backing_resource_name, key);
    return c.json({ success: true });
  } catch (err) {
    logError("Failed to delete object", err, {
      module: "routes/resources/r2",
    });
    throw new InternalError("Failed to delete object");
  }
}

const resourcesR2 = new Hono<AuthenticatedRouteEnv>()
  .get("/:id/r2/objects", listObjectsValidator, listObjectsHandler)
  .get("/:id/objects", listObjectsValidator, listObjectsHandler)
  .get("/:id/r2/stats", objectStatsHandler)
  .get("/:id/objects-stats", objectStatsHandler)
  .get("/:id/objects/:key", getObjectHandler)
  .put("/:id/objects/:key", putObjectValidator, putObjectHandler)
  .delete("/:id/r2/objects/:key", deleteObjectHandler)
  .delete("/:id/objects/:key", deleteObjectHandler);

export default resourcesR2;
