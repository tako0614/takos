import { Hono } from 'hono';
import { z } from 'zod';
import { requireSpaceAccess, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import {
  getStorageItem,
  createFileRecord,
  confirmUpload,
  createFileWithContent,
  uploadPendingFileContent,
  MAX_FILE_SIZE,
  PRESIGN_EXPIRY_SECONDS,
} from '../../../application/services/source/space-storage';
import { BadRequestError, NotFoundError, InternalError } from '@takos/common/errors';
import { requireOAuthScope, handleStorageError } from './storage-operations';

const app = new Hono<AuthenticatedRouteEnv>()
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
      const file = await createFileWithContent(
        c.env.DB,
        c.env.GIT_OBJECTS,
        access.space.id,
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
  // --- Upload URL ---
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
    if (typeof body.size !== 'number' || body.size <= 0) {
      throw new BadRequestError('Valid file size is required');
    }
    if (body.size > MAX_FILE_SIZE) {
      throw new BadRequestError(`File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    if (!c.env.GIT_OBJECTS) {
      throw new InternalError('Storage not configured');
    }

    try {
      const { file, r2Key } = await createFileRecord(c.env.DB, access.space.id, user.id, {
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
  // --- Upload file content ---
  .put('/:spaceId/storage/upload/:fileId',
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

    if (!c.env.GIT_OBJECTS) {
      throw new InternalError('Storage not configured');
    }

    try {
      const fileRecord = await getStorageItem(c.env.DB, access.space.id, fileId);
      const declaredSize = fileRecord?.size ?? 0;

      const body = await c.req.arrayBuffer();
      await uploadPendingFileContent(
        c.env.DB,
        c.env.GIT_OBJECTS,
        access.space.id,
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
  // --- Confirm upload ---
  .post('/:spaceId/storage/confirm-upload',
    requireOAuthScope('files:write'),
    zValidator('json', z.object({
      file_id: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    })),
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
    if (!body.file_id) {
      throw new BadRequestError('file_id is required');
    }

    if (!c.env.GIT_OBJECTS) {
      throw new InternalError('Storage not configured');
    }

    try {
      const file = await confirmUpload(c.env.DB, c.env.GIT_OBJECTS, access.space.id, body.file_id, body.sha256);
      if (!file) {
        throw new NotFoundError('File');
      }
      return c.json({ file });
    } catch (err) {
      return handleStorageError(c, err);
    }
  });

export default app;
