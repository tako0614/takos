import { Hono } from 'hono';
import { generateId, now } from '../../../shared/utils';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { checkRepoAccess } from '../../../application/services/source/repos';
import { generateExploreInvalidationUrls, hasWriteRole } from './routes';
import { getDb } from '../../../infra/db';
import { repoReleases, repoReleaseAssets } from '../../../infra/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { invalidateCacheOnMutation } from '../../middleware/cache';
import { type ReleaseAsset, toReleaseAsset, toReleaseAssets } from '../../../application/services/source/repo-release-assets';
import { BadRequestError, AuthorizationError, NotFoundError, InternalError } from '@takoserver/common/errors';
import { sanitizeReleaseAssetFilename, buildAttachmentDisposition } from './release-shared';

const releaseAssets = new Hono<AuthenticatedRouteEnv>()
  .post('/repos/:repoId/releases/:tag/assets', invalidateCacheOnMutation([generateExploreInvalidationUrls]), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const tag = c.req.param('tag');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  if (!hasWriteRole(repoAccess.role)) {
    throw new AuthorizationError();
  }

  const releaseData = await db.select().from(repoReleases)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
    .get();

  if (!releaseData) {
    throw new NotFoundError('Release');
  }

  const contentType = c.req.header('content-type') || '';
  let fileData: ArrayBuffer;
  let uploadedFileName: string;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      throw new BadRequestError('No file uploaded');
    }

    // After null/string checks, `file` is a File (Blob with name)
    uploadedFileName = file.name || 'asset';
    fileData = await file.arrayBuffer();
  } else {
    throw new BadRequestError('Invalid content type. Use multipart/form-data');
  }

  if (fileData.byteLength === 0) {
    throw new BadRequestError('Empty file');
  }

  if (fileData.byteLength > 100 * 1024 * 1024) {
    throw new BadRequestError('File too large. Maximum size is 100MB');
  }

  if (!c.env.GIT_OBJECTS) {
    throw new InternalError('Storage not configured');
  }

  const fileName = sanitizeReleaseAssetFilename(uploadedFileName);
  const fileNameLower = fileName.toLowerCase();
  const assetId = generateId();
  const r2Key = `release-assets/${repoId}/${releaseData.id}/${assetId}/${fileName}`;
  const timestamp = now();

  let detectedContentType = 'application/octet-stream';
  if (fileNameLower.endsWith('.takopack')) {
    detectedContentType = 'application/x-takopack';
  } else if (fileNameLower.endsWith('.zip')) {
    detectedContentType = 'application/zip';
  } else if (fileNameLower.endsWith('.tar.gz') || fileNameLower.endsWith('.tgz')) {
    detectedContentType = 'application/gzip';
  } else if (fileNameLower.endsWith('.json')) {
    detectedContentType = 'application/json';
  }

  const bundleFormat: string | undefined = undefined;
  const bundleMeta: ReleaseAsset['bundle_meta'] | undefined = undefined;

  await c.env.GIT_OBJECTS.put(r2Key, fileData, {
    httpMetadata: { contentType: detectedContentType },
    customMetadata: {
      releaseId: releaseData.id,
      repoId,
      fileName,
      uploadedBy: user.id,
    },
  });

  const newAsset: ReleaseAsset = {
    id: assetId,
    name: fileName,
    content_type: detectedContentType,
    size: fileData.byteLength,
    r2_key: r2Key,
    download_count: 0,
    bundle_format: bundleFormat,
    bundle_meta: bundleMeta,
    created_at: timestamp,
  };

  await db.insert(repoReleaseAssets).values({
    id: assetId,
    releaseId: releaseData.id,
    assetKey: r2Key,
    name: fileName,
    contentType: detectedContentType,
    sizeBytes: fileData.byteLength,
    downloadCount: 0,
    bundleFormat: bundleFormat ?? null,
    bundleMetaJson: bundleMeta ? JSON.stringify(bundleMeta) : null,
    createdAt: timestamp,
  });
  await db.update(repoReleases)
    .set({ updatedAt: timestamp })
    .where(eq(repoReleases.id, releaseData.id));

  return c.json({
    asset: {
      id: newAsset.id,
      name: newAsset.name,
      content_type: newAsset.content_type,
      size: newAsset.size,
      download_count: 0,
      bundle_format: newAsset.bundle_format,
      bundle_meta: newAsset.bundle_meta,
      created_at: newAsset.created_at,
    },
  }, 201);
  })
  .get('/repos/:repoId/releases/:tag/assets/:assetId/download', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const tag = c.req.param('tag');
  const assetId = c.req.param('assetId');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const releaseData = await db.select().from(repoReleases)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
    .get();

  if (!releaseData) {
    throw new NotFoundError('Release');
  }

  if (releaseData.isDraft) {
    const canSeeDrafts = hasWriteRole(repoAccess.role);
    if (!canSeeDrafts) {
      throw new NotFoundError('Release');
    }
  }

  const assetRow = await db.select().from(repoReleaseAssets)
    .where(and(
      eq(repoReleaseAssets.id, assetId),
      eq(repoReleaseAssets.releaseId, releaseData.id),
    ))
    .get();
  const asset = assetRow ? toReleaseAsset(assetRow) : null;

  if (!asset) {
    throw new NotFoundError('Asset');
  }

  if (!c.env.GIT_OBJECTS) {
    throw new InternalError('Storage not configured');
  }

  await db.update(repoReleaseAssets)
    .set({ downloadCount: asset.download_count + 1 })
    .where(eq(repoReleaseAssets.id, assetId));
  await db.update(repoReleases)
    .set({ downloads: releaseData.downloads + 1 })
    .where(eq(repoReleases.id, releaseData.id));

  const object = await c.env.GIT_OBJECTS.get(asset.r2_key);

  if (!object) {
    throw new NotFoundError('Asset file');
  }

  const headers = new Headers();
  headers.set('Content-Type', asset.content_type);
  headers.set('Content-Disposition', buildAttachmentDisposition(asset.name));
  headers.set('Content-Length', String(asset.size));

  // R2ObjectBody.body is a ReadableStream; cast required because CF types
  // use their own ReadableStream definition which differs from the standard BodyInit.
  return new Response(object.body as ReadableStream, { headers });
  })
  .delete('/repos/:repoId/releases/:tag/assets/:assetId', invalidateCacheOnMutation([generateExploreInvalidationUrls]), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const tag = c.req.param('tag');
  const assetId = c.req.param('assetId');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  if (!hasWriteRole(repoAccess.role)) {
    throw new AuthorizationError();
  }

  const releaseData = await db.select().from(repoReleases)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
    .get();

  if (!releaseData) {
    throw new NotFoundError('Release');
  }

  const assetRow = await db.select().from(repoReleaseAssets)
    .where(and(
      eq(repoReleaseAssets.id, assetId),
      eq(repoReleaseAssets.releaseId, releaseData.id),
    ))
    .get();
  const asset = assetRow ? toReleaseAsset(assetRow) : null;

  if (!asset) {
    throw new NotFoundError('Asset');
  }

  if (c.env.GIT_OBJECTS) {
    await c.env.GIT_OBJECTS.delete(asset.r2_key);
  }

  await db.delete(repoReleaseAssets).where(eq(repoReleaseAssets.id, assetId));
  await db.update(repoReleases)
    .set({ updatedAt: now() })
    .where(eq(repoReleases.id, releaseData.id));

  return c.json({ deleted: true });
  })
  .get('/repos/:repoId/releases/:tag/assets', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const tag = c.req.param('tag');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const releaseData = await db.select().from(repoReleases)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
    .get();

  if (!releaseData) {
    throw new NotFoundError('Release');
  }

  if (releaseData.isDraft) {
    const canSeeDrafts = hasWriteRole(repoAccess.role);
    if (!canSeeDrafts) {
      throw new NotFoundError('Release');
    }
  }

  const assetsData = await db.select().from(repoReleaseAssets)
    .where(eq(repoReleaseAssets.releaseId, releaseData.id))
    .orderBy(asc(repoReleaseAssets.createdAt))
    .all();

  const assets = toReleaseAssets(assetsData);

  return c.json({
    assets: assets.map(a => ({
      id: a.id,
      name: a.name,
      content_type: a.content_type,
      size: a.size,
      download_count: a.download_count,
      bundle_format: a.bundle_format,
      bundle_meta: a.bundle_meta,
      created_at: a.created_at,
    })),
  });
  });

export default releaseAssets;
