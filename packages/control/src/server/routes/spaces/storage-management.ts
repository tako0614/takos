import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
} from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import {
  bulkDeleteStorageItems,
  createFolder,
  deleteR2Objects,
  deleteStorageItem,
  getStorageItem,
  listStorageFiles,
  moveAndRenameStorageItem,
  moveStorageItem,
  renameStorageItem,
} from "../../../application/services/source/space-storage.ts";
import type { StorageFileResponse } from "../../../application/services/source/space-storage.ts";
import { BadRequestError, NotFoundError } from "takos-common/errors";
import {
  handleStorageError,
  MAX_BULK_OPERATION_ITEMS,
  requireOAuthScope,
  storageBulkLimiter,
} from "./storage-operations.ts";
import {
  buildPublicUrl,
  listPublications,
  type PublicationRecord,
  publicationResolvedUrl,
} from "../../../application/services/platform/service-publications.ts";

export const storageManagementRouteDeps = {
  requireSpaceAccess,
  listStorageFiles,
  getStorageItem,
  createFolder,
  deleteStorageItem,
  renameStorageItem,
  moveAndRenameStorageItem,
  moveStorageItem,
  bulkDeleteStorageItems,
  deleteR2Objects,
};

export function buildFileHandlerOpenUrl(
  serviceHostname: string,
  openPath: string,
  fileId: string,
): string {
  if (!fileHandlerPathHasIdTemplate(openPath)) {
    throw new Error("FileHandler path must include :id");
  }
  return buildPublicUrl(
    serviceHostname,
    openPath,
    { id: fileId },
  );
}

export type ProjectedFileHandler = {
  idx: number;
  id: string;
  name: string;
  title?: string;
  mimeTypes: string[];
  extensions: string[];
  open_url: string;
};

export function fileHandlerPathHasIdTemplate(
  path: string | undefined,
): boolean {
  return typeof path === "string" &&
    path.split("/").some((segment) => segment === ":id");
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeHandlerExtension(value: string): string {
  const lower = value.toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}

export function projectFileHandlerPublication(
  record: PublicationRecord,
  idx: number,
): ProjectedFileHandler | null {
  if (
    record.publicationType !== "FileHandler" &&
    record.publicationType !== "takos.file-handler.v1"
  ) return null;
  const openUrl = publicationResolvedUrl(record);
  if (!openUrl) return null;
  const legacyPath = record.publication.path ??
    record.publication.outputs?.url?.route;
  const path = legacyPath ??
    (() => {
      try {
        return new URL(openUrl).pathname;
      } catch {
        return undefined;
      }
    })();
  if (!fileHandlerPathHasIdTemplate(path)) return null;

  const spec = record.publication.spec ?? {};
  const mimeTypes = readStringList(spec.mimeTypes).map((value) =>
    value.toLowerCase()
  );
  const extensions = readStringList(spec.extensions).map(
    normalizeHandlerExtension,
  );
  if (mimeTypes.length === 0 && extensions.length === 0) return null;

  return {
    idx,
    id: `publication:${record.id}`,
    name: record.name,
    ...(record.publication.title ? { title: record.publication.title } : {}),
    mimeTypes,
    extensions,
    open_url: openUrl,
  };
}

const app = new Hono<AuthenticatedRouteEnv>()
  .use("/:spaceId/storage/bulk-delete", storageBulkLimiter.middleware())
  .use("/:spaceId/storage/bulk-move", storageBulkLimiter.middleware())
  .use("/:spaceId/storage/bulk-rename", storageBulkLimiter.middleware())
  // --- File handlers endpoint ---
  .get(
    "/:spaceId/storage/file-handlers",
    requireOAuthScope("files:read"),
    zValidator(
      "query",
      z.object({
        mime: z.string().optional(),
        ext: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const { mime, ext } = c.req.valid("query");

      // ext を normalize (`.md` も `md` も受ける)
      const normalizedExt = ext
        ? (ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`)
        : undefined;
      const normalizedMime = mime?.toLowerCase();

      const access = await storageManagementRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      const projected =
        (await listPublications({ DB: c.env.DB }, access.space.id))
          .map(projectFileHandlerPublication)
          .filter((handler): handler is ProjectedFileHandler =>
            handler !== null
          );

      // filter: mime と ext のいずれかが指定されたら、そのいずれかにマッチするものを残す
      const filtered = projected.filter((p) => {
        const matchesMime = normalizedMime
          ? p.mimeTypes.includes(normalizedMime)
          : false;
        const matchesExt = normalizedExt
          ? p.extensions.includes(normalizedExt)
          : false;
        if (normalizedMime && normalizedExt) {
          return matchesMime || matchesExt;
        } else if (normalizedMime) {
          return matchesMime;
        } else if (normalizedExt) {
          return matchesExt;
        }
        return true;
      });

      // rank: 0 = 完全一致 (両方マッチ), 1 = mime 一致, 2 = ext 一致, 3 = filter 無し
      const ranked = filtered.map((p) => {
        let rank = 3;
        if (normalizedMime && normalizedExt) {
          const mimeOk = p.mimeTypes.includes(normalizedMime);
          const extOk = p.extensions.includes(normalizedExt);
          if (mimeOk && extOk) rank = 0;
          else if (mimeOk) rank = 1;
          else if (extOk) rank = 2;
        } else if (normalizedMime) {
          rank = 1;
        } else if (normalizedExt) {
          rank = 2;
        }
        return { ...p, rank };
      });

      // sort: rank ASC, idx ASC (declaration order tie-break)
      ranked.sort((a, b) => a.rank - b.rank || a.idx - b.idx);

      return c.json({
        handlers: ranked.map((p) => ({
          id: p.id,
          name: p.name,
          title: p.title,
          mime_types: p.mimeTypes,
          extensions: p.extensions,
          open_url: p.open_url,
        })),
      });
    },
  )
  // --- List storage ---
  .get(
    "/:spaceId/storage",
    requireOAuthScope("files:read"),
    zValidator("query", z.object({ path: z.string().optional() })),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const { path: queryPath } = c.req.valid("query");
      const path = queryPath || "/";

      const access = await storageManagementRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      const result = await storageManagementRouteDeps.listStorageFiles(
        c.env.DB,
        access.space.id,
        path,
      );

      return c.json({ files: result.files, path, truncated: result.truncated });
    },
  )
  // --- Create folder ---
  .post(
    "/:spaceId/storage/folders",
    requireOAuthScope("files:write"),
    zValidator(
      "json",
      z.object({ name: z.string(), parent_path: z.string().optional() }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await storageManagementRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
        ["owner", "admin", "editor"],
        "Workspace not found or insufficient permissions",
      );

      const body = c.req.valid("json");
      if (!body.name) {
        throw new BadRequestError("Name is required");
      }

      try {
        const folder = await storageManagementRouteDeps.createFolder(
          c.env.DB,
          access.space.id,
          user.id,
          {
            name: body.name,
            parentPath: body.parent_path,
          },
        );
        return c.json({ folder }, 201);
      } catch (err) {
        return handleStorageError(c, err);
      }
    },
  )
  // --- Get storage item ---
  .get(
    "/:spaceId/storage/:fileId",
    requireOAuthScope("files:read"),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const fileId = c.req.param("fileId");

      const access = await storageManagementRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      const file = await storageManagementRouteDeps.getStorageItem(
        c.env.DB,
        access.space.id,
        fileId,
      );
      if (!file) {
        throw new NotFoundError("File or folder");
      }

      return c.json({ file });
    },
  )
  // --- Delete storage item ---
  .delete(
    "/:spaceId/storage/:fileId",
    requireOAuthScope("files:write"),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const fileId = c.req.param("fileId");

      const access = await storageManagementRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
        ["owner", "admin", "editor"],
        "Workspace not found or insufficient permissions",
      );

      try {
        const r2KeysToDelete = await storageManagementRouteDeps
          .deleteStorageItem(c.env.DB, access.space.id, fileId);

        if (r2KeysToDelete.length > 0 && c.env.GIT_OBJECTS) {
          try {
            await storageManagementRouteDeps.deleteR2Objects(
              c.env.GIT_OBJECTS,
              r2KeysToDelete,
            );
          } catch {
            // R2 deletion failure is non-fatal; DB records are already removed
          }
        }

        return c.json({
          success: true,
          deleted_count: r2KeysToDelete.length + 1,
        });
      } catch (err) {
        return handleStorageError(c, err);
      }
    },
  )
  // --- Rename/move storage item ---
  .patch(
    "/:spaceId/storage/:fileId",
    requireOAuthScope("files:write"),
    zValidator(
      "json",
      z.object({
        name: z.string().optional(),
        parent_path: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const fileId = c.req.param("fileId");

      const access = await storageManagementRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
        ["owner", "admin", "editor"],
        "Workspace not found or insufficient permissions",
      );

      const body = c.req.valid("json");

      if (!body.name && body.parent_path === undefined) {
        throw new BadRequestError("Either name or parent_path is required");
      }

      try {
        let file;

        if (body.parent_path !== undefined && body.name) {
          file = await storageManagementRouteDeps.moveAndRenameStorageItem(
            c.env.DB,
            access.space.id,
            fileId,
            {
              parentPath: body.parent_path,
              name: body.name,
            },
          );
        } else if (body.parent_path !== undefined) {
          file = await storageManagementRouteDeps.moveStorageItem(
            c.env.DB,
            access.space.id,
            fileId,
            {
              parentPath: body.parent_path,
            },
          );
        } else if (body.name) {
          file = await storageManagementRouteDeps.renameStorageItem(
            c.env.DB,
            access.space.id,
            fileId,
            {
              name: body.name,
            },
          );
        }

        return c.json({ file });
      } catch (err) {
        return handleStorageError(c, err);
      }
    },
  )
  // --- Bulk delete ---
  .post(
    "/:spaceId/storage/bulk-delete",
    requireOAuthScope("files:write"),
    zValidator("json", z.object({ file_ids: z.array(z.string()) })),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await storageManagementRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
        ["owner", "admin", "editor"],
        "Workspace not found or insufficient permissions",
      );

      const body = c.req.valid("json");
      if (!Array.isArray(body.file_ids) || body.file_ids.length === 0) {
        throw new BadRequestError("file_ids array is required");
      }
      if (body.file_ids.length > MAX_BULK_OPERATION_ITEMS) {
        throw new BadRequestError(
          `file_ids must contain at most ${MAX_BULK_OPERATION_ITEMS} items`,
        );
      }

      try {
        const bulkDeleteResult = await storageManagementRouteDeps
          .bulkDeleteStorageItems(c.env.DB, access.space.id, body.file_ids);

        if (bulkDeleteResult.r2Keys.length > 0 && c.env.GIT_OBJECTS) {
          try {
            await storageManagementRouteDeps.deleteR2Objects(
              c.env.GIT_OBJECTS,
              bulkDeleteResult.r2Keys,
            );
          } catch {
            // R2 deletion failure is non-fatal
          }
        }

        return c.json({
          success: true,
          deleted_count: bulkDeleteResult.deletedCount,
          error_count: bulkDeleteResult.failedIds.length,
          failed_ids: bulkDeleteResult.failedIds,
        });
      } catch (err) {
        return handleStorageError(c, err);
      }
    },
  )
  // --- Bulk move ---
  .post(
    "/:spaceId/storage/bulk-move",
    requireOAuthScope("files:write"),
    zValidator(
      "json",
      z.object({ file_ids: z.array(z.string()), parent_path: z.string() }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await storageManagementRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
        ["owner", "admin", "editor"],
        "Workspace not found or insufficient permissions",
      );

      const body = c.req.valid("json");
      if (!Array.isArray(body.file_ids) || body.file_ids.length === 0) {
        throw new BadRequestError("file_ids array is required");
      }
      if (body.file_ids.length > MAX_BULK_OPERATION_ITEMS) {
        throw new BadRequestError(
          `file_ids must contain at most ${MAX_BULK_OPERATION_ITEMS} items`,
        );
      }
      if (typeof body.parent_path !== "string") {
        throw new BadRequestError("parent_path is required");
      }

      const moved: StorageFileResponse[] = [];
      const errors: Array<{ file_id: string; error: string }> = [];

      for (const fileId of body.file_ids) {
        try {
          const file = await storageManagementRouteDeps.moveStorageItem(
            c.env.DB,
            access.space.id,
            fileId,
            { parentPath: body.parent_path },
          );
          moved.push(file);
        } catch (err) {
          errors.push({
            file_id: fileId,
            error: err instanceof Error ? err.message : "Failed to move",
          });
        }
      }

      return c.json({
        moved,
        errors,
        success_count: moved.length,
        error_count: errors.length,
      });
    },
  )
  // --- Bulk rename ---
  .post(
    "/:spaceId/storage/bulk-rename",
    requireOAuthScope("files:write"),
    zValidator(
      "json",
      z.object({
        renames: z.array(z.object({ file_id: z.string(), name: z.string() })),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await storageManagementRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
        ["owner", "admin", "editor"],
        "Workspace not found or insufficient permissions",
      );

      const body = c.req.valid("json");
      if (!Array.isArray(body.renames) || body.renames.length === 0) {
        throw new BadRequestError("renames array is required");
      }
      if (body.renames.length > MAX_BULK_OPERATION_ITEMS) {
        throw new BadRequestError(
          `renames must contain at most ${MAX_BULK_OPERATION_ITEMS} items`,
        );
      }

      const renamed: StorageFileResponse[] = [];
      const errors: Array<{ file_id: string; error: string }> = [];

      for (const item of body.renames) {
        if (
          !item || typeof item.file_id !== "string" ||
          typeof item.name !== "string"
        ) {
          continue;
        }
        try {
          const file = await storageManagementRouteDeps.renameStorageItem(
            c.env.DB,
            access.space.id,
            item.file_id,
            { name: item.name },
          );
          renamed.push(file);
        } catch (err) {
          errors.push({
            file_id: item.file_id,
            error: err instanceof Error ? err.message : "Failed to rename",
          });
        }
      }

      return c.json({
        renamed,
        errors,
        success_count: renamed.length,
        error_count: errors.length,
      });
    },
  );

export default app;
