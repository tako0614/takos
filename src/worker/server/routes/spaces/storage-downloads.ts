import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
} from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import {
  escapeSqlLike,
  getStorageItemByPath,
  MAX_ZIP_ENTRIES,
  normalizeStorageMimeType,
  normalizePath,
  readFileContent,
  writeFileContent,
} from "../../../application/services/source/space-storage.ts";
import { createZipStream } from "../../../shared/utils/zip-stream.ts";
import { getDb } from "../../../infra/db/index.ts";
import { and, asc, eq, sql } from "drizzle-orm";
import { accountStorageFiles } from "../../../infra/db/schema.ts";
import {
  BadRequestError,
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
} from "@takos/worker-platform-utils/errors";
import {
  handleStorageError,
  isStorageMimeTypeSafeForInline,
  requireOAuthScope,
  storageArchiveLimiter,
} from "./storage-operations.ts";
import { MAX_STORAGE_PATH_CHARACTERS } from "../../../shared/types/index.ts";

export function buildStorageZipEntryName(
  filePath: string,
  normalizedFolderPath: string,
): string {
  const prefix = normalizedFolderPath === "/"
    ? "/"
    : `${normalizedFolderPath}/`;
  if (!filePath.startsWith(prefix)) {
    throw new InternalError("Storage archive contains an invalid file path");
  }
  const relative = filePath.slice(prefix.length);
  if (
    !relative || relative.startsWith("/") || relative.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(relative) ||
    relative.split("/").some((segment) =>
      !segment || segment === "." || segment === ".."
    )
  ) {
    throw new InternalError("Storage archive contains an invalid file path");
  }
  return relative;
}

const app = new Hono<AuthenticatedRouteEnv>()
  .use(
    "/:spaceId/storage/download-zip",
    storageArchiveLimiter.middleware(),
  )
  // --- Content read endpoint ---
  .get(
    "/:spaceId/storage/:fileId/content",
    requireOAuthScope("files:read"),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const fileId = c.req.param("fileId");

      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      if (!c.env.GIT_OBJECTS) {
        throw new InternalError("Storage not configured");
      }

      try {
        const result = await readFileContent(
          c.env.DB,
          c.env.GIT_OBJECTS,
          access.space.id,
          fileId,
        );
        return c.json({
          content: result.content,
          file: result.file,
          encoding: result.encoding,
        });
      } catch (err) {
        return handleStorageError(c, err);
      }
    },
  )
  // --- Content write endpoint ---
  .put(
    "/:spaceId/storage/:fileId/content",
    requireOAuthScope("files:write"),
    zValidator(
      "json",
      z.object({
        content: z.string(),
        mime_type: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const fileId = c.req.param("fileId");

      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
        "Workspace not found",
      );

      if (!c.env.GIT_OBJECTS) {
        throw new InternalError("Storage not configured");
      }

      const body = c.req.valid("json");

      try {
        const file = await writeFileContent(
          c.env.DB,
          c.env.GIT_OBJECTS,
          access.space.id,
          fileId,
          body.content,
          user.id,
          body.mime_type,
        );
        return c.json({ file });
      } catch (err) {
        return handleStorageError(c, err);
      }
    },
  )
  // --- Download file ---
  .get(
    "/:spaceId/storage/download/:fileId",
    requireOAuthScope("files:read"),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const fileId = c.req.param("fileId");

      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      if (!c.env.GIT_OBJECTS) {
        throw new InternalError("Storage not configured");
      }

      const db = getDb(c.env.DB);
      const fileRecord = await db.select({
        id: accountStorageFiles.id,
        name: accountStorageFiles.name,
        type: accountStorageFiles.type,
        size: accountStorageFiles.size,
        r2Key: accountStorageFiles.r2Key,
        mimeType: accountStorageFiles.mimeType,
      }).from(accountStorageFiles)
        .where(
          and(
            eq(accountStorageFiles.id, fileId),
            eq(accountStorageFiles.accountId, access.space.id),
          ),
        ).get();

      if (!fileRecord) {
        throw new NotFoundError("File");
      }

      if (fileRecord.type !== "file") {
        throw new BadRequestError("Cannot download a folder");
      }

      if (!fileRecord.r2Key) {
        throw new NotFoundError("File");
      }

      const object = await c.env.GIT_OBJECTS.get(fileRecord.r2Key);
      if (!object) {
        throw new NotFoundError("File");
      }

      let contentType = "application/octet-stream";
      for (
        const candidate of [
          fileRecord.mimeType,
          object.httpMetadata?.contentType,
        ]
      ) {
        try {
          const normalized = normalizeStorageMimeType(candidate);
          if (normalized) {
            contentType = normalized;
            break;
          }
        } catch {
          // Legacy or provider metadata may be invalid. Serve it as opaque
          // bytes instead of copying an unsafe value into a response header.
        }
      }
      // Force attachment for types that could execute in browser (XSS prevention)
      const isSafeForInline = isStorageMimeTypeSafeForInline(contentType);
      const disposition = isSafeForInline ? "inline" : "attachment";

      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Content-Length", String(object.size));
      headers.set(
        "Content-Disposition",
        `${disposition}; filename*=UTF-8''${
          encodeURIComponent(fileRecord.name)
        }`,
      );
      headers.set("Cache-Control", "private, no-store");

      return new Response(object.body as BodyInit, { headers });
    },
  )
  // --- Download ZIP ---
  .get(
    "/:spaceId/storage/download-zip",
    requireOAuthScope("files:read"),
    zValidator(
      "query",
      z.object({
        path: z.string().max(MAX_STORAGE_PATH_CHARACTERS).optional(),
      }).strict(),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const path = normalizePath(c.req.valid("query").path?.trim() || "/");

      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      const gitObjects = c.env.GIT_OBJECTS;
      if (!gitObjects) {
        throw new InternalError("Storage not configured");
      }

      if (path !== "/" && path.trim() !== "") {
        const folder = await getStorageItemByPath(
          c.env.DB,
          access.space.id,
          path,
        );
        if (!folder || folder.type !== "folder") {
          throw new NotFoundError("Folder");
        }
      }

      const db = getDb(c.env.DB);
      const normalizedPath = path;
      const prefix = normalizedPath === "/" ? "/" : `${normalizedPath}/`;
      const escapedPrefix = escapeSqlLike(prefix);

      const selectedFiles = await db.select({
        id: accountStorageFiles.id,
        path: accountStorageFiles.path,
        size: accountStorageFiles.size,
        r2Key: accountStorageFiles.r2Key,
        updatedAt: accountStorageFiles.updatedAt,
      }).from(accountStorageFiles).where(
        and(
          eq(accountStorageFiles.accountId, access.space.id),
          eq(accountStorageFiles.type, "file"),
          sql`${accountStorageFiles.path} LIKE ${
            escapedPrefix + "%"
          } ESCAPE '\\'`,
        ),
      ).orderBy(asc(accountStorageFiles.path)).limit(MAX_ZIP_ENTRIES + 1)
        .all();

      if (selectedFiles.length > MAX_ZIP_ENTRIES) {
        throw new PayloadTooLargeError(
          `Storage archive exceeds the ${MAX_ZIP_ENTRIES}-file limit`,
        );
      }

      const entries = selectedFiles.map((file) => {
        if (!file.r2Key) {
          throw new InternalError(
            "Storage archive contains a file without content",
          );
        }
        const modifiedTimestamp = Date.parse(file.updatedAt);
        if (!Number.isFinite(modifiedTimestamp)) {
          throw new InternalError("Storage archive metadata is invalid");
        }
        return {
          name: buildStorageZipEntryName(file.path, normalizedPath),
          size: file.size,
          modifiedAt: new Date(modifiedTimestamp),
          stream: async () => {
            const obj = await gitObjects.get(file.r2Key as string);
            if (!obj || !obj.body) {
              throw new Error("Storage archive object is missing");
            }
            return obj.body as ReadableStream<Uint8Array>;
          },
        };
      });

      const baseName = normalizedPath === "/"
        ? "space-storage"
        : normalizedPath.split("/").filter(Boolean).pop() || "folder";
      const fileName = `${baseName}.zip`;

      const headers = new Headers();
      headers.set("Content-Type", "application/zip");
      headers.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      headers.set("Cache-Control", "no-store");
      headers.set("X-Takos-Zip-Entries", String(entries.length));

      const stream = createZipStream(entries);
      return new Response(stream, { status: 200, headers });
    },
  );

export default app;
