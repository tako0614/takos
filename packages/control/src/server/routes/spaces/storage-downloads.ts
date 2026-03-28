import { Hono } from 'hono';
import { z } from 'zod';
import { requireSpaceAccess, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import {
  getStorageItem,
  getStorageItemByPath,
  readFileContent,
  writeFileContent,
  escapeSqlLike,
  PRESIGN_EXPIRY_SECONDS,
  MAX_ZIP_ENTRIES,
} from '../../../application/services/source/space-storage';
import { createZipStream } from '../../../shared/utils/zip-stream';
import { getDb } from '../../../infra/db';
import { eq, and, sql, asc } from 'drizzle-orm';
import { accountStorageFiles } from '../../../infra/db/schema';
import { BadRequestError, NotFoundError, InternalError } from 'takos-common/errors';
import { requireOAuthScope, handleStorageError, INLINE_SAFE_MIME_PREFIXES } from './storage-operations';

const app = new Hono<AuthenticatedRouteEnv>()
  // --- Content read endpoint ---
  .get('/:spaceId/storage/:fileId/content',
    requireOAuthScope('files:read'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await requireSpaceAccess(c, spaceId, user.id);

    if (!c.env.GIT_OBJECTS) {
      throw new InternalError('Storage not configured');
    }

    try {
      const result = await readFileContent(c.env.DB, c.env.GIT_OBJECTS, access.space.id, fileId);
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

    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions'
    );

    if (!c.env.GIT_OBJECTS) {
      throw new InternalError('Storage not configured');
    }

    const body = c.req.valid('json');

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
  })
  // --- Download file ---
  .get('/:spaceId/storage/download/:fileId',
    requireOAuthScope('files:read'),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const fileId = c.req.param('fileId');

    const access = await requireSpaceAccess(c, spaceId, user.id);

    if (!c.env.GIT_OBJECTS) {
      throw new InternalError('Storage not configured');
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
      .where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, access.space.id))).get();

    if (!fileRecord) {
      throw new NotFoundError('File');
    }

    if (fileRecord.type !== 'file') {
      throw new BadRequestError('Cannot download a folder');
    }

    if (!fileRecord.r2Key) {
      throw new NotFoundError('File');
    }

    const object = await c.env.GIT_OBJECTS.get(fileRecord.r2Key);
    if (!object) {
      throw new NotFoundError('File');
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
  // --- Download URL ---
  .get('/:spaceId/storage/download-url',
    requireOAuthScope('files:read'),
    zValidator('query', z.object({ file_id: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const { file_id: fileId } = c.req.valid('query');

    if (!fileId) {
      throw new BadRequestError('file_id is required');
    }

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const file = await getStorageItem(c.env.DB, access.space.id, fileId);
    if (!file) {
      throw new NotFoundError('File');
    }

    if (file.type !== 'file') {
      throw new BadRequestError('Cannot download a folder');
    }

    const downloadUrl = new URL(`/api/spaces/${spaceId}/storage/download/${fileId}`, c.req.url).toString();
    const expiresAt = new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString();

    return c.json({
      download_url: downloadUrl,
      expires_at: expiresAt,
      file,
    });
  })
  // --- Download ZIP ---
  .get('/:spaceId/storage/download-zip',
    requireOAuthScope('files:read'),
    zValidator('query', z.object({ path: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const path = c.req.valid('query').path || '/';

    const access = await requireSpaceAccess(c, spaceId, user.id);

    if (!c.env.GIT_OBJECTS) {
      throw new InternalError('Storage not configured');
    }

    if (path !== '/' && path.trim() !== '') {
      const folder = await getStorageItemByPath(c.env.DB, access.space.id, path);
      if (!folder || folder.type !== 'folder') {
        throw new NotFoundError('Folder');
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
        eq(accountStorageFiles.accountId, access.space.id),
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
      ? 'space-storage'
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

export default app;
