import { Hono } from 'hono';
import { z } from 'zod';
import { requireSpaceAccess, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import {
  listStorageFiles,
  getStorageItem,
  createFolder,
  deleteStorageItem,
  renameStorageItem,
  moveStorageItem,
  bulkDeleteStorageItems,
  deleteR2Objects,
} from '../../../application/services/source/space-storage';
import type { StorageFileResponse } from '../../../application/services/source/space-storage';
import { getDb } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import { fileHandlers, fileHandlerMatchers } from '../../../infra/db/schema';
import { BadRequestError, NotFoundError } from 'takos-common/errors';
import { requireOAuthScope, handleStorageError, storageBulkLimiter, MAX_BULK_OPERATION_ITEMS } from './storage-operations';

const app = new Hono<AuthenticatedRouteEnv>()
  .use('/:spaceId/storage/bulk-delete', storageBulkLimiter.middleware())
  .use('/:spaceId/storage/bulk-move', storageBulkLimiter.middleware())
  .use('/:spaceId/storage/bulk-rename', storageBulkLimiter.middleware())
  // --- File handlers endpoint ---
  .get('/:spaceId/storage/file-handlers',
    requireOAuthScope('files:read'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const db = getDb(c.env.DB);
    const handlers = await db.select()
      .from(fileHandlers)
      .where(eq(fileHandlers.accountId, access.space.id))
      .all();

    const handlerIds = handlers.map(h => h.id);
    const matcherRows = handlerIds.length > 0
      ? await Promise.all(handlerIds.map(id =>
          db.select().from(fileHandlerMatchers)
            .where(eq(fileHandlerMatchers.fileHandlerId, id)).all()
        )).then(results => results.flat())
      : [];

    const matchersByHandlerId = new Map<string, typeof matcherRows>();
    for (const m of matcherRows) {
      const list = matchersByHandlerId.get(m.fileHandlerId) || [];
      list.push(m);
      matchersByHandlerId.set(m.fileHandlerId, list);
    }

    return c.json({
      handlers: handlers.map(h => {
        const matchers = matchersByHandlerId.get(h.id) || [];
        return {
          id: h.id,
          name: h.name,
          mime_types: matchers.filter((m) => m.kind === 'mime').map((m) => m.value),
          extensions: matchers.filter((m) => m.kind === 'extension').map((m) => m.value),
          open_url: `https://${h.serviceHostname}${h.openPath}`,
        };
      }),
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

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const result = await listStorageFiles(c.env.DB, access.space.id, path);

    return c.json({ files: result.files, path, truncated: result.truncated });
  })
  // --- Create folder ---
  .post('/:spaceId/storage/folders',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ name: z.string(), parent_path: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(
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
      const folder = await createFolder(c.env.DB, access.space.id, user.id, {
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

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const file = await getStorageItem(c.env.DB, access.space.id, fileId);
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

    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );

    try {
      const r2KeysToDelete = await deleteStorageItem(c.env.DB, access.space.id, fileId);

      if (r2KeysToDelete.length > 0 && c.env.GIT_OBJECTS) {
        try {
          await deleteR2Objects(c.env.GIT_OBJECTS, r2KeysToDelete);
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

    const access = await requireSpaceAccess(
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
        file = await moveStorageItem(c.env.DB, access.space.id, fileId, {
          parentPath: body.parent_path,
        });
        file = await renameStorageItem(c.env.DB, access.space.id, fileId, {
          name: body.name,
        });
      } else if (body.parent_path !== undefined) {
        file = await moveStorageItem(c.env.DB, access.space.id, fileId, {
          parentPath: body.parent_path,
        });
      } else if (body.name) {
        file = await renameStorageItem(c.env.DB, access.space.id, fileId, {
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

    const access = await requireSpaceAccess(
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
      const bulkDeleteResult = await bulkDeleteStorageItems(c.env.DB, access.space.id, body.file_ids);

      if (bulkDeleteResult.r2Keys.length > 0 && c.env.GIT_OBJECTS) {
        try {
          await deleteR2Objects(c.env.GIT_OBJECTS, bulkDeleteResult.r2Keys);
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

    const access = await requireSpaceAccess(
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
        const file = await moveStorageItem(c.env.DB, access.space.id, fileId, { parentPath: body.parent_path });
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

    const access = await requireSpaceAccess(
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
        const file = await renameStorageItem(c.env.DB, access.space.id, item.file_id, { name: item.name });
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
