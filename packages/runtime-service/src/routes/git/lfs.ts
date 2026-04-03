import type { Context, Hono } from "hono";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  badRequest,
  internalError,
  notFound,
} from "takos-common/middleware/hono";
import { REPOS_BASE_DIR } from "../../shared/config.ts";
import {
  isPathWithinBase,
  verifyPathWithinAfterAccess,
} from "../../runtime/paths.ts";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import {
  buildLfsBatchObjectResponse,
  getLfsObjectPath,
  LFS_CONTENT_TYPE,
  LFS_UPLOAD_TOO_LARGE_ERROR,
  MAX_LFS_UPLOAD_BYTES,
  parseContentLength,
  parseLfsBatchRequest,
} from "./lfs-policy.ts";
import {
  fileExists,
  resolveRepoGitDir,
  validateLfsObjectOid,
  validateLfsObjectRequest,
} from "./validators.ts";

export {
  buildLfsBatchObjectResponse,
  getLfsObjectPath,
  LFS_CONTENT_TYPE,
  LFS_UPLOAD_TOO_LARGE_ERROR,
  MAX_LFS_UPLOAD_BYTES,
  normalizeLfsOid,
  parseContentLength,
  parseLfsBatchRequest,
} from "./lfs-policy.ts";

export function getLfsObjectHref(
  c: Context<RuntimeEnv>,
  spaceId: string,
  repoName: string,
  oid: string,
): string {
  const protocol = c.req.header("x-forwarded-proto") || "http";
  const host = c.req.header("host") || "localhost";
  return `${protocol}://${host}/git/${spaceId}/${repoName}.git/info/lfs/objects/${oid}`;
}

async function handleBatch(c: Context<RuntimeEnv>): Promise<Response> {
  const resolved = await resolveRepoGitDir(c);
  if ("error" in resolved) return resolved.error;

  const body = await c.req.json();
  const parsedRequest = parseLfsBatchRequest(body);
  if (!parsedRequest) {
    return badRequest(c, "Invalid LFS batch request");
  }

  const { operation, objects: requestObjects } = parsedRequest;
  const objects = await Promise.all(
    requestObjects.map(async ({ oid, size }) => {
      const objectPath = getLfsObjectPath(resolved.repoGitDir, oid);

      if (!isPathWithinBase(resolved.repoGitDir, objectPath)) {
        return {
          oid,
          size,
          error: {
            code: 400,
            message: "Invalid object path",
          },
        };
      }

      const exists = await fileExists(objectPath);
      const href = getLfsObjectHref(
        c,
        resolved.spaceId,
        resolved.repoName,
        oid,
      );
      return buildLfsBatchObjectResponse({
        operation,
        oid,
        size,
        exists,
        href,
      });
    }),
  );

  c.header("content-type", LFS_CONTENT_TYPE);
  return c.json({
    transfer: "basic",
    objects,
  });
}

async function handleUpload(c: Context<RuntimeEnv>): Promise<Response> {
  const oidResult = validateLfsObjectOid(c);
  if (typeof oidResult === "object" && "error" in oidResult) {
    return oidResult.error;
  }

  const contentLength = parseContentLength(c.req.header("content-length"));
  if (Number.isNaN(contentLength)) {
    return badRequest(c, "Invalid Content-Length");
  }
  if (
    typeof contentLength === "number" &&
    contentLength > MAX_LFS_UPLOAD_BYTES
  ) {
    return c.json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "LFS object too large",
      },
    }, 413);
  }

  const validatedObject = await validateLfsObjectRequest(c, oidResult);
  if ("error" in validatedObject) return validatedObject.error;

  const { objectPath } = validatedObject;
  if (await fileExists(objectPath)) {
    return c.body(null, 200);
  }

  await fsPromises.mkdir(path.dirname(objectPath), { recursive: true });

  const tempPath = `${objectPath}.tmp-${Date.now()}-${
    Math.random().toString(16).slice(2)
  }`;
  try {
    let receivedBytes = 0;
    const sizeLimiter = new Transform({
      transform(chunk, _encoding, callback) {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_LFS_UPLOAD_BYTES) {
          callback(new Error(LFS_UPLOAD_TOO_LARGE_ERROR));
          return;
        }
        callback(null, chunk);
      },
    });

    const rawBody = c.req.raw.body;
    if (!rawBody) {
      return badRequest(c, "Missing request body");
    }
    const nodeStream = Readable.fromWeb(
      rawBody as Parameters<typeof Readable.fromWeb>[0],
    );

    await pipeline(
      nodeStream,
      sizeLimiter,
      fs.createWriteStream(tempPath, { flags: "wx" }),
    );
    await fsPromises.rename(tempPath, objectPath);

    try {
      await verifyPathWithinAfterAccess(
        REPOS_BASE_DIR,
        objectPath,
        "LFS upload target",
      );
    } catch {
      await fsPromises.rm(objectPath, { force: true }).catch(() => undefined);
      return badRequest(c, "Invalid LFS object path");
    }
  } catch (err) {
    await fsPromises.rm(tempPath, { force: true }).catch(() => undefined);
    const errMessage = err instanceof Error ? err.message : undefined;
    const errCode = err instanceof Error && "code" in err
      ? (err as NodeJS.ErrnoException).code
      : undefined;
    if (errMessage === LFS_UPLOAD_TOO_LARGE_ERROR) {
      return c.json({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "LFS object too large",
        },
      }, 413);
    }
    if (errCode === "EEXIST") {
      return c.body(null, 200);
    }
    throw err;
  }

  return c.body(null, 200);
}

async function handleDownload(c: Context<RuntimeEnv>): Promise<Response> {
  const validatedObject = await validateLfsObjectRequest(c);
  if ("error" in validatedObject) return validatedObject.error;
  const { objectPath } = validatedObject;

  let stats: fs.Stats;
  try {
    stats = await fsPromises.stat(objectPath);
    if (!stats.isFile()) {
      return notFound(c, "LFS object not found");
    }
  } catch (err) {
    const errCode = err instanceof Error && "code" in err
      ? (err as NodeJS.ErrnoException).code
      : undefined;
    if (errCode === "ENOENT") {
      return notFound(c, "LFS object not found");
    }
    throw err;
  }

  try {
    await verifyPathWithinAfterAccess(REPOS_BASE_DIR, objectPath, "LFS object");
  } catch {
    return notFound(c, "LFS object not found");
  }

  const buffer = await fsPromises.readFile(objectPath);
  return new Response(new Blob([new Uint8Array(buffer)]), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(stats.size),
    },
  });
}

function wrapLfsHandler(
  logMessage: string,
  handler: (c: Context<RuntimeEnv>) => Promise<Response>,
) {
  return async (c: Context<RuntimeEnv>) => {
    try {
      return await handler(c);
    } catch (err) {
      c.get("log")?.error(logMessage, { error: err as Error });
      return internalError(c);
    }
  };
}

export function registerGitLfsRoutes(app: Hono<RuntimeEnv>): void {
  app.post(
    "/git/:spaceId/:repoName.git/info/lfs/objects/batch",
    wrapLfsHandler("Git LFS batch error", handleBatch),
  );
  app.put(
    "/git/:spaceId/:repoName.git/info/lfs/objects/:oid",
    wrapLfsHandler("Git LFS upload error", handleUpload),
  );
  app.get(
    "/git/:spaceId/:repoName.git/info/lfs/objects/:oid",
    wrapLfsHandler("Git LFS download error", handleDownload),
  );
}

export const registerLfsRoutes = registerGitLfsRoutes;
