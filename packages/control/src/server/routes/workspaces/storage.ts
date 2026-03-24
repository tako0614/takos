import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { requireWorkspaceAccess, type AuthenticatedRouteEnv } from '../shared/helpers';
import { zValidator } from '../zod-validator';
import {
  listStorageFiles,
  getStorageItem,
  getStorageItemByPath,
  createFolder,
  createFileRecord,
  confirmUpload,
  deleteStorageItem,
  renameStorageItem,
  moveStorageItem,
  bulkDeleteStorageItems,
  deleteR2Objects,
  readFileContent,
  writeFileContent,
  createFileWithContent,
  uploadPendingFileContent,
  escapeSqlLike,
  StorageError,
  MAX_FILE_SIZE,
  PRESIGN_EXPIRY_SECONDS,
  MAX_ZIP_ENTRIES,
} from '../../../application/services/source/workspace-storage';
import type { StorageFileResponse } from '../../../application/services/source/workspace-storage';
import { createZipStream } from '../../../shared/utils/zip-stream';
import { getDb } from '../../../infra/db';
import { eq, and, sql, asc } from 'drizzle-orm';
import { fileHandlers, fileHandlerMatchers, accountStorageFiles } from '../../../infra/db/schema';
import { RateLimiters } from '../../../shared/utils/rate-limiter';
import type { OAuthContext } from '../../middleware/oauth-auth';
import type { Context } from 'hono';
import { badRequest, forbidden, notFound, conflict, internalError, badGateway, payloadTooLarge } from '../../../shared/utils/error-response';

const storageBulkLimiter = RateLimiters.sensitive();
const MAX_BULK_OPERATION_ITEMS = 200;

const INLINE_SAFE_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'application/pdf'];

function requireOAuthScope(scope: string): MiddlewareHandler<AuthenticatedRouteEnv> {
  return async (c, next) => {
    // OAuth middleware may set 'oauth' on the context variables.
    // Access via generic get() since the type is not declared in AuthenticatedRouteEnv.
    const oauth = (c.get as (key: string) => unknown)('oauth') as OAuthContext | undefined;
    if (oauth && !oauth.scopes.includes(scope)) {
      return c.json({
        error: 'insufficient_scope',
        error_description: `Required scope: ${scope}`,
      }, 403);
    }
    await next();
  };
}

function handleStorageError(c: Context, err: unknown): Response {
  if (err instanceof StorageError) {
    switch (err.code) {
      case 'NOT_FOUND':
        return notFound(c, err.message.replace(/ not found$/, '') || 'Resource');
      case 'CONFLICT':
        return conflict(c, err.message);
      case 'TOO_LARGE':
        return payloadTooLarge(c, err.message);
      case 'STORAGE_ERROR':
        return badGateway(c, err.message);
      case 'VALIDATION':
        return badRequest(c, err.message);
    }
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return internalError(c, message);
}

export default new Hono<AuthenticatedRouteEnv>()
  .use('/:spaceId/storage/bulk-delete', storageBulkLimiter.middleware())
  .use('/:spaceId/storage/bulk-move', storageBulkLimiter.middleware())
  .use('/:spaceId/storage/bulk-rename', storageBulkLimiter.middleware())
  // --- Content read endpoints ---
  .get('/:spaceId/storage/:fileId/content',
    requireOAuthScope('files:read'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await requireWorkspaceAccess(c, spaceId, user.id);
    if (access instanceof Response) return access;

    if (!c.env.GIT_OBJECTS) {
      return internalError(c, 'Storage not configured');
    }

    try {
      const result = await readFileContent(c.env.DB, c.env.GIT_OBJECTS, access.workspace.id, fileId);
      return c.json({
        content: result.content,
        file: result.file,
        encoding: result.encoding,
      });
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  // --- Content write endpoint ---
  .put('/:spaceId/storage/:fileId/content',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({
      content: z.string(),
      mime_type: z.string().optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    if (!c.env.GIT_OBJECTS) {
      return internalError(c, 'Storage not configured');
    }

    const body = c.req.valid('json');

    try {
      const file = await writeFileContent(
        c.env.DB,
        c.env.GIT_OBJECTS,
        access.workspace.id,
        fileId,
        body.content,
        user.id,
        body.mime_type,
      );
      return c.json({ file });
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  // --- Create file with content ---
  .post('/:spaceId/storage/files',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({
      path: z.string(),
      content: z.string(),
      mime_type: z.string().optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    if (!c.env.GIT_OBJECTS) {
      return internalError(c, 'Storage not configured');
    }

    const body = c.req.valid('json');

    try {
      const file = await createFileWithContent(
        c.env.DB,
        c.env.GIT_OBJECTS,
        access.workspace.id,
        user.id,
        body.path,
        body.content,
        body.mime_type,
      );
      return c.json({ file }, 201);
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  // --- File handlers endpoint ---
  .get('/:spaceId/storage/file-handlers',
    requireOAuthScope('files:read'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(c, spaceId, user.id);
    if (access instanceof Response) return access;

    const db = getDb(c.env.DB);
    const handlers = await db.select()
      .from(fileHandlers)
      .where(eq(fileHandlers.accountId, access.workspace.id))
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
  // --- Existing endpoints ---
  .get('/:spaceId/storage',
    requireOAuthScope('files:read'),
    zValidator('query', z.object({ path: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const { path: queryPath } = c.req.valid('query');
    const path = queryPath || '/';

    const access = await requireWorkspaceAccess(c, spaceId, user.id);
    if (access instanceof Response) return access;

    const result = await listStorageFiles(c.env.DB, access.workspace.id, path);

    return c.json({ files: result.files, path, truncated: result.truncated });
  })
  .post('/:spaceId/storage/folders',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ name: z.string(), parent_path: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    const body = c.req.valid('json');
    if (!body.name) {
      return badRequest(c, 'Name is required');
    }

    try {
      const folder = await createFolder(c.env.DB, access.workspace.id, user.id, {
        name: body.name,
        parentPath: body.parent_path,
      });
      return c.json({ folder }, 201);
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  .post('/:spaceId/storage/upload-url',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({
      name: z.string(),
      parent_path: z.string().optional(),
      size: z.number(),
      mime_type: z.string().optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    const body = c.req.valid('json');

    if (!body.name) {
      return badRequest(c, 'Name is required');
    }
    if (typeof body.size !== 'number' || body.size <= 0) {
      return badRequest(c, 'Valid file size is required');
    }
    if (body.size > MAX_FILE_SIZE) {
      return badRequest(c, `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    if (!c.env.GIT_OBJECTS) {
      return internalError(c, 'Storage not configured');
    }

    try {
      const { file, r2Key } = await createFileRecord(c.env.DB, access.workspace.id, user.id, {
        name: body.name,
        parentPath: body.parent_path,
        size: body.size,
        mimeType: body.mime_type,
      });

      const uploadUrl = new URL(`/api/spaces/${spaceId}/storage/upload/${file.id}`, c.req.url).toString();
      const expiresAt = new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString();

      return c.json({
        file_id: file.id,
        upload_url: uploadUrl,
        r2_key: r2Key,
        expires_at: expiresAt,
      }, 201);
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  .put('/:spaceId/storage/upload/:fileId',
    requireOAuthScope('files:write'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    if (!c.env.GIT_OBJECTS) {
      return internalError(c, 'Storage not configured');
    }

    try {
      const fileRecord = await getStorageItem(c.env.DB, access.workspace.id, fileId);
      const declaredSize = fileRecord?.size ?? 0;

      const body = await c.req.arrayBuffer();
      await uploadPendingFileContent(
        c.env.DB,
        c.env.GIT_OBJECTS,
        access.workspace.id,
        fileId,
        body,
        declaredSize,
        c.req.header('Content-Type') ?? undefined,
      );
      return c.body(null, 204);
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  .post('/:spaceId/storage/confirm-upload',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({
      file_id: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    const body = c.req.valid('json');
    if (!body.file_id) {
      return badRequest(c, 'file_id is required');
    }

    if (!c.env.GIT_OBJECTS) {
      return internalError(c, 'Storage not configured');
    }

    try {
      const file = await confirmUpload(c.env.DB, c.env.GIT_OBJECTS, access.workspace.id, body.file_id, body.sha256);
      if (!file) {
        return notFound(c, 'File');
      }
      return c.json({ file });
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  .get('/:spaceId/storage/download/:fileId',
    requireOAuthScope('files:read'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await requireWorkspaceAccess(c, spaceId, user.id);
    if (access instanceof Response) return access;

    if (!c.env.GIT_OBJECTS) {
      return internalError(c, 'Storage not configured');
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
      .where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, access.workspace.id))).get();

    if (!fileRecord) {
      return notFound(c, 'File');
    }

    if (fileRecord.type !== 'file') {
      return badRequest(c, 'Cannot download a folder');
    }

    if (!fileRecord.r2Key) {
      return notFound(c, 'File');
    }

    const object = await c.env.GIT_OBJECTS.get(fileRecord.r2Key);
    if (!object) {
      return notFound(c, 'File');
    }

    const contentType = fileRecord.mimeType || object.httpMetadata?.contentType || 'application/octet-stream';
    // Force attachment for types that could execute in browser (XSS prevention)
    const isSafeForInline = INLINE_SAFE_MIME_PREFIXES.some(p => contentType.startsWith(p)) || contentType === 'text/plain';
    const disposition = isSafeForInline ? 'inline' : 'attachment';

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Content-Length', String(fileRecord.size));
    headers.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(fileRecord.name)}`);
    headers.set('Cache-Control', 'private, no-store');

    return new Response(object.body as BodyInit, { headers });
  })
  .get('/:spaceId/storage/download-url',
    requireOAuthScope('files:read'),
    zValidator('query', z.object({ file_id: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const { file_id: fileId } = c.req.valid('query');

    if (!fileId) {
      return badRequest(c, 'file_id is required');
    }

    const access = await requireWorkspaceAccess(c, spaceId, user.id);
    if (access instanceof Response) return access;

    const file = await getStorageItem(c.env.DB, access.workspace.id, fileId);
    if (!file) {
      return notFound(c, 'File');
    }

    if (file.type !== 'file') {
      return badRequest(c, 'Cannot download a folder');
    }

    const downloadUrl = new URL(`/api/spaces/${spaceId}/storage/download/${fileId}`, c.req.url).toString();
    const expiresAt = new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString();

    return c.json({
      download_url: downloadUrl,
      expires_at: expiresAt,
      file,
    });
  })
  .get('/:spaceId/storage/:fileId',
    requireOAuthScope('files:read'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await requireWorkspaceAccess(c, spaceId, user.id);
    if (access instanceof Response) return access;

    const file = await getStorageItem(c.env.DB, access.workspace.id, fileId);
    if (!file) {
      return notFound(c, 'File or folder');
    }

    return c.json({ file });
  })
  .delete('/:spaceId/storage/:fileId',
    requireOAuthScope('files:write'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    try {
      const r2KeysToDelete = await deleteStorageItem(c.env.DB, access.workspace.id, fileId);

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
  .patch('/:spaceId/storage/:fileId',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ name: z.string().optional(), parent_path: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    const body = c.req.valid('json');

    if (!body.name && body.parent_path === undefined) {
      return badRequest(c, 'Either name or parent_path is required');
    }

    try {
      let file;

      if (body.parent_path !== undefined && body.name) {
        // Move + rename: do move first, then rename in sequence
        // If rename fails after move, the move is still applied (partial update)
        // but this is preferable to silent data loss
        file = await moveStorageItem(c.env.DB, access.workspace.id, fileId, {
          parentPath: body.parent_path,
        });
        file = await renameStorageItem(c.env.DB, access.workspace.id, fileId, {
          name: body.name,
        });
      } else if (body.parent_path !== undefined) {
        file = await moveStorageItem(c.env.DB, access.workspace.id, fileId, {
          parentPath: body.parent_path,
        });
      } else if (body.name) {
        file = await renameStorageItem(c.env.DB, access.workspace.id, fileId, {
          name: body.name,
        });
      }

      return c.json({ file });
    } catch (err) {
      return handleStorageError(c, err);
    }
  })
  .post('/:spaceId/storage/bulk-delete',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ file_ids: z.array(z.string()) })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    const body = c.req.valid('json');
    if (!Array.isArray(body.file_ids) || body.file_ids.length === 0) {
      return badRequest(c, 'file_ids array is required');
    }
    if (body.file_ids.length > MAX_BULK_OPERATION_ITEMS) {
      return badRequest(c, `file_ids must contain at most ${MAX_BULK_OPERATION_ITEMS} items`);
    }

    try {
      const bulkDeleteResult = await bulkDeleteStorageItems(c.env.DB, access.workspace.id, body.file_ids);

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
  .post('/:spaceId/storage/bulk-move',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ file_ids: z.array(z.string()), parent_path: z.string() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    const body = c.req.valid('json');
    if (!Array.isArray(body.file_ids) || body.file_ids.length === 0) {
      return badRequest(c, 'file_ids array is required');
    }
    if (body.file_ids.length > MAX_BULK_OPERATION_ITEMS) {
      return badRequest(c, `file_ids must contain at most ${MAX_BULK_OPERATION_ITEMS} items`);
    }
    if (typeof body.parent_path !== 'string') {
      return badRequest(c, 'parent_path is required');
    }

    const moved: StorageFileResponse[] = [];
    const errors: Array<{ file_id: string; error: string }> = [];

    for (const fileId of body.file_ids) {
      try {
        const file = await moveStorageItem(c.env.DB, access.workspace.id, fileId, { parentPath: body.parent_path });
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
  .post('/:spaceId/storage/bulk-rename',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({ renames: z.array(z.object({ file_id: z.string(), name: z.string() })) })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;

    const body = c.req.valid('json');
    if (!Array.isArray(body.renames) || body.renames.length === 0) {
      return badRequest(c, 'renames array is required');
    }
    if (body.renames.length > MAX_BULK_OPERATION_ITEMS) {
      return badRequest(c, `renames must contain at most ${MAX_BULK_OPERATION_ITEMS} items`);
    }

    const renamed: StorageFileResponse[] = [];
    const errors: Array<{ file_id: string; error: string }> = [];

    for (const item of body.renames) {
      if (!item || typeof item.file_id !== 'string' || typeof item.name !== 'string') {
        continue;
      }
      try {
        const file = await renameStorageItem(c.env.DB, access.workspace.id, item.file_id, { name: item.name });
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
  })
  .get('/:spaceId/storage/download-zip',
    requireOAuthScope('files:read'),
    zValidator('query', z.object({ path: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const path = c.req.valid('query').path || '/';

    const access = await requireWorkspaceAccess(c, spaceId, user.id);
    if (access instanceof Response) return access;

    if (!c.env.GIT_OBJECTS) {
      return internalError(c, 'Storage not configured');
    }

    if (path !== '/' && path.trim() !== '') {
      const folder = await getStorageItemByPath(c.env.DB, access.workspace.id, path);
      if (!folder || folder.type !== 'folder') {
        return notFound(c, 'Folder');
      }
    }

    const db = getDb(c.env.DB);
    const normalizedPath = path.startsWith('/') ? path.replace(/\/+$/, '') || '/' : `/${path.replace(/\/+$/, '')}`;
    const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`;
    const escapedPrefix = escapeSqlLike(prefix);

    const files = await db.select({
      id: accountStorageFiles.id,
      path: accountStorageFiles.path,
      size: accountStorageFiles.size,
      r2Key: accountStorageFiles.r2Key,
      updatedAt: accountStorageFiles.updatedAt,
    }).from(accountStorageFiles).where(
      and(
        eq(accountStorageFiles.accountId, access.workspace.id),
        eq(accountStorageFiles.type, 'file'),
        sql`${accountStorageFiles.path} LIKE ${escapedPrefix + '%'} ESCAPE '\\'`,
      )
    ).orderBy(asc(accountStorageFiles.path)).limit(MAX_ZIP_ENTRIES).all();

    const entries = files
      .filter((f) => typeof f.r2Key === 'string' && f.r2Key)
      .map((f) => {
        const zipName = normalizedPath === '/'
          ? f.path.replace(/^\//, '')
          : f.path.startsWith(prefix)
            ? f.path.slice(prefix.length)
            : f.path.replace(/^\//, '');
        return {
          name: zipName || f.id,
          size: f.size,
          modifiedAt: new Date(f.updatedAt),
          stream: async () => {
            const obj = await c.env.GIT_OBJECTS!.get(f.r2Key as string);
            if (!obj || !obj.body) {
              throw new Error(`Missing object: ${f.r2Key}`);
            }
            return obj.body as ReadableStream<Uint8Array>;
          },
        };
      });

    const baseName = normalizedPath === '/'
      ? 'workspace-storage'
      : normalizedPath.split('/').filter(Boolean).pop() || 'folder';
    const fileName = `${baseName}.zip`;

    const headers = new Headers();
    headers.set('Content-Type', 'application/zip');
    headers.set('Content-Disposition', `attachment; filename="${fileName}"`);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Takos-Zip-Entries', String(entries.length));
    if (files.length >= MAX_ZIP_ENTRIES) {
      headers.set('X-Takos-Zip-Truncated', 'true');
    }

    const stream = createZipStream(entries);
    return new Response(stream, { status: 200, headers });
  });
