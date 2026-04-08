import { Hono } from 'hono';
import { z } from 'zod';
import { requireSpaceAccess, type AuthenticatedRouteEnv } from '../route-auth.ts';
import { zValidator } from '../zod-validator.ts';
import {
  listStorageFiles,
  getStorageItem,
  createFolder,
  deleteStorageItem,
  renameStorageItem,
  moveStorageItem,
  bulkDeleteStorageItems,
  deleteR2Objects,
} from '../../../application/services/source/space-storage.ts';
import type { StorageFileResponse } from '../../../application/services/source/space-storage.ts';
import { getDb } from '../../../infra/db/index.ts';
import { asc, eq } from 'drizzle-orm';
import { fileHandlers, fileHandlerMatchers } from '../../../infra/db/schema.ts';
import { BadRequestError, NotFoundError } from 'takos-common/errors';
import { requireOAuthScope, handleStorageError, storageBulkLimiter, MAX_BULK_OPERATION_ITEMS } from './storage-operations.ts';

export const storageManagementRouteDeps = {
  requireSpaceAccess,
  listStorageFiles,
  getStorageItem,
  createFolder,
  deleteStorageItem,
  renameStorageItem,
  moveStorageItem,
  bulkDeleteStorageItems,
  deleteR2Objects,
  getDb,
};

const app = new Hono<AuthenticatedRouteEnv>()
  .use('/:spaceId/storage/bulk-delete', storageBulkLimiter.middleware())
  .use('/:spaceId/storage/bulk-move', storageBulkLimiter.middleware())
  .use('/:spaceId/storage/bulk-rename', storageBulkLimiter.middleware())
  // --- File handlers endpoint ---
  .get('/:spaceId/storage/file-handlers',
    requireOAuthScope('files:read'),
    zValidator('query', z.object({
      mime: z.string().optional(),
      ext: z.string().optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const { mime, ext } = c.req.valid('query');

    // ext を normalize (`.md` も `md` も受ける)
    const normalizedExt = ext ? (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`) : undefined;
    const normalizedMime = mime?.toLowerCase();

    const access = await storageManagementRouteDeps.requireSpaceAccess(c, spaceId, user.id);

    const db = storageManagementRouteDeps.getDb(c.env.DB);
    const handlers = await db.select()
      .from(fileHandlers)
      .where(eq(fileHandlers.accountId, access.space.id))
      .orderBy(asc(fileHandlers.createdAt), asc(fileHandlers.id))
      .all();

    const handlerIds = handlers.map(h => h.id);
    const matcherRows = handlerIds.length > 0
      ? (await Promise.all(handlerIds.map(id =>
          db.select().from(fileHandlerMatchers)
            .where(eq(fileHandlerMatchers.fileHandlerId, id)).all()
        ))).flat()
      : [];

    const matchersByHandlerId = new Map<string, typeof matcherRows>();
    for (const m of matcherRows) {
      const list = matchersByHandlerId.get(m.fileHandlerId) || [];
      list.push(m);
      matchersByHandlerId.set(m.fileHandlerId, list);
    }

    // project + filter + rank
    const projected = handlers.map((h, idx) => {
      const matchers = matchersByHandlerId.get(h.id) || [];
      const mimeTypes = matchers.filter((m) => m.kind === 'mime').map((m) => m.value.toLowerCase());
      const extensions = matchers.filter((m) => m.kind === 'extension').map((m) => m.value.toLowerCase());
      return {
        idx,
        id: h.id,
        name: h.name,
        mimeTypes,
        extensions,
        open_url: `https://${h.serviceHostname}${h.openPath}`,
      };
    });

    // filter: mime と ext のいずれかが指定されたら、そのいずれかにマッチするものを残す
    const filtered = projected.filter((p) => {
      const matchesMime = normalizedMime ? p.mimeTypes.includes(normalizedMime) : false;
      const matchesExt = normalizedExt ? p.extensions.includes(normalizedExt) : false;
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
        mime_types: p.mimeTypes,
        extensions: p.extensions,
        open_url: p.open_url,
      })),
    });
  })
  // --- List storage ---
  .get('/:spaceId/storage',
    requireOAuthScope('files:read'),
    zValidator('query', z.object({ path: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const { path: queryPath } = c.req.valid('query');
    const path = queryPath || '/';

    const access = await storageManagementRouteDeps.requireSpaceAccess(c, spaceId, user.id);

    const result = await storageManagementRouteDeps.listStorageFiles(c.env.DB, access.space.id, path);

    return c.json({ files: result.files, path, truncated: result.truncated });
  })
  // --- Create folder ---
  .post('/:spaceId/storage/folders',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ name: z.string(), parent_path: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await storageManagementRouteDeps.requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );

    const body = c.req.valid('json');
    if (!body.name) {
      throw new BadRequestError('Name is required');
    }

    try {
      const folder = await storageManagementRouteDeps.createFolder(c.env.DB, access.space.id, user.id, {
        name: body.name,
        parentPath: body.parent_path,
      });
      return c.json({ folder }, 201);
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  // --- Get storage item ---
  .get('/:spaceId/storage/:fileId',
    requireOAuthScope('files:read'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await storageManagementRouteDeps.requireSpaceAccess(c, spaceId, user.id);

    const file = await storageManagementRouteDeps.getStorageItem(c.env.DB, access.space.id, fileId);
    if (!file) {
      throw new NotFoundError('File or folder');
    }

    return c.json({ file });
  })
  // --- Delete storage item ---
  .delete('/:spaceId/storage/:fileId',
    requireOAuthScope('files:write'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await storageManagementRouteDeps.requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );

    try {
      const r2KeysToDelete = await storageManagementRouteDeps.deleteStorageItem(c.env.DB, access.space.id, fileId);

      if (r2KeysToDelete.length > 0 && c.env.GIT_OBJECTS) {
        try {
          await storageManagementRouteDeps.deleteR2Objects(c.env.GIT_OBJECTS, r2KeysToDelete);
        } catch {
          // R2 deletion failure is non-fatal; DB records are already removed
        }
      }

      return c.json({ success: true, deleted_count: r2KeysToDelete.length + 1 });
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  // --- Rename/move storage item ---
  .patch('/:spaceId/storage/:fileId',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ name: z.string().optional(), parent_path: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await storageManagementRouteDeps.requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );

    const body = c.req.valid('json');

    if (!body.name && body.parent_path === undefined) {
      throw new BadRequestError('Either name or parent_path is required');
    }

    try {
      let file;

      if (body.parent_path !== undefined && body.name) {
        // Move + rename: do move first, then rename in sequence
        // If rename fails after move, the move is still applied (partial update)
        // but this is preferable to silent data loss
        file = await storageManagementRouteDeps.moveStorageItem(c.env.DB, access.space.id, fileId, {
          parentPath: body.parent_path,
        });
        file = await storageManagementRouteDeps.renameStorageItem(c.env.DB, access.space.id, fileId, {
          name: body.name,
        });
      } else if (body.parent_path !== undefined) {
        file = await storageManagementRouteDeps.moveStorageItem(c.env.DB, access.space.id, fileId, {
          parentPath: body.parent_path,
        });
      } else if (body.name) {
        file = await storageManagementRouteDeps.renameStorageItem(c.env.DB, access.space.id, fileId, {
          name: body.name,
        });
      }

      return c.json({ file });
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  // --- Bulk delete ---
  .post('/:spaceId/storage/bulk-delete',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ file_ids: z.array(z.string()) })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await storageManagementRouteDeps.requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );

    const body = c.req.valid('json');
    if (!Array.isArray(body.file_ids) || body.file_ids.length === 0) {
      throw new BadRequestError('file_ids array is required');
    }
    if (body.file_ids.length > MAX_BULK_OPERATION_ITEMS) {
      throw new BadRequestError(`file_ids must contain at most ${MAX_BULK_OPERATION_ITEMS} items`);
    }

    try {
      const bulkDeleteResult = await storageManagementRouteDeps.bulkDeleteStorageItems(c.env.DB, access.space.id, body.file_ids);

      if (bulkDeleteResult.r2Keys.length > 0 && c.env.GIT_OBJECTS) {
        try {
          await storageManagementRouteDeps.deleteR2Objects(c.env.GIT_OBJECTS, bulkDeleteResult.r2Keys);
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
  })
  // --- Bulk move ---
  .post('/:spaceId/storage/bulk-move',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ file_ids: z.array(z.string()), parent_path: z.string() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await storageManagementRouteDeps.requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );

    const body = c.req.valid('json');
    if (!Array.isArray(body.file_ids) || body.file_ids.length === 0) {
      throw new BadRequestError('file_ids array is required');
    }
    if (body.file_ids.length > MAX_BULK_OPERATION_ITEMS) {
      throw new BadRequestError(`file_ids must contain at most ${MAX_BULK_OPERATION_ITEMS} items`);
    }
    if (typeof body.parent_path !== 'string') {
      throw new BadRequestError('parent_path is required');
    }

    const moved: StorageFileResponse[] = [];
    const errors: Array<{ file_id: string; error: string }> = [];

    for (const fileId of body.file_ids) {
      try {
        const file = await storageManagementRouteDeps.moveStorageItem(c.env.DB, access.space.id, fileId, { parentPath: body.parent_path });
        moved.push(file);
      } catch (err) {
        errors.push({ file_id: fileId, error: err instanceof Error ? err.message : 'Failed to move' });
      }
    }

    return c.json({
      moved,
      errors,
      success_count: moved.length,
      error_count: errors.length,
    });
  })
  // --- Bulk rename ---
  .post('/:spaceId/storage/bulk-rename',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ renames: z.array(z.object({ file_id: z.string(), name: z.string() })) })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await storageManagementRouteDeps.requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );

    const body = c.req.valid('json');
    if (!Array.isArray(body.renames) || body.renames.length === 0) {
      throw new BadRequestError('renames array is required');
    }
    if (body.renames.length > MAX_BULK_OPERATION_ITEMS) {
      throw new BadRequestError(`renames must contain at most ${MAX_BULK_OPERATION_ITEMS} items`);
    }

    const renamed: StorageFileResponse[] = [];
    const errors: Array<{ file_id: string; error: string }> = [];

    for (const item of body.renames) {
      if (!item || typeof item.file_id !== 'string' || typeof item.name !== 'string') {
        continue;
      }
      try {
        const file = await storageManagementRouteDeps.renameStorageItem(c.env.DB, access.space.id, item.file_id, { name: item.name });
        renamed.push(file);
      } catch (err) {
        errors.push({ file_id: item.file_id, error: err instanceof Error ? err.message : 'Failed to rename' });
      }
    }

    return c.json({
      renamed,
      errors,
      success_count: renamed.length,
      error_count: errors.length,
    });
  });

export default app;
