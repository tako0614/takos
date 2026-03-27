import { Hono } from 'hono';
import { z } from 'zod';
import { generateId, now } from '../../../shared/utils';
import { parseLimit, parseOffset } from '../shared/route-auth';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import { checkRepoAccess } from '../../../application/services/source/repos';
import type { ReleaseAsset } from '../../../application/services/takopack/types';
import { generateExploreInvalidationUrls, hasWriteRole } from './base';
import { getDb } from '../../../infra/db';
import { repoReleases, repoReleaseAssets, accounts } from '../../../infra/db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { invalidateCacheOnMutation } from '../../middleware/cache';
import { parseManifestOnly } from '../../../application/services/takopack/manifest';
import { toReleaseAsset, toReleaseAssets } from '../../../application/services/source/repo-release-assets';
import { logWarn } from '../../../shared/utils/logger';
import { BadRequestError, AuthorizationError, NotFoundError, ConflictError, InternalError } from '@takos/common/errors';

const MAX_RELEASE_ASSET_FILENAME_LENGTH = 180;

function sanitizeReleaseAssetFilename(fileName: string): string {
  const normalized = fileName
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\\/g, '/');

  const basename = normalized.split('/').pop() || '';
  const withoutTraversal = basename.replace(/\.\.+/g, '.');
  const collapsed = withoutTraversal.replace(/\s+/g, ' ').trim();
  const safe = collapsed
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, MAX_RELEASE_ASSET_FILENAME_LENGTH);

  return safe || 'asset.bin';
}

function buildAttachmentDisposition(fileName: string): string {
  const sanitized = sanitizeReleaseAssetFilename(fileName);
  const asciiFallback = sanitized.replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(sanitized)
    .replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/** Fetch a release with its assets and author in separate queries */
async function fetchReleaseWithDetails(
  db: ReturnType<typeof getDb>,
  releaseId: string,
) {
  const release = await db.select().from(repoReleases).where(eq(repoReleases.id, releaseId)).get();
  if (!release) return null;

  const assets = await db.select().from(repoReleaseAssets)
    .where(eq(repoReleaseAssets.releaseId, releaseId))
    .orderBy(asc(repoReleaseAssets.createdAt))
    .all();

  let author: { id: string; name: string; picture: string | null } | null = null;
  if (release.authorAccountId) {
    const authorData = await db.select({
      id: accounts.id,
      name: accounts.name,
      picture: accounts.picture,
    }).from(accounts).where(eq(accounts.id, release.authorAccountId)).get();
    author = authorData ?? null;
  }

  return { ...release, repoReleaseAssets: assets, authorAccount: author };
}

export default new Hono<AuthenticatedRouteEnv>()
  .get('/repos/:repoId/releases', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const offset = parseOffset(c.req.query('offset'));
  const includeDrafts = c.req.query('include_drafts') === 'true';
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const canSeeDrafts = hasWriteRole(repoAccess.role);
  const showDrafts = includeDrafts && canSeeDrafts;

  const releaseWhere = showDrafts
    ? eq(repoReleases.repoId, repoId)
    : and(eq(repoReleases.repoId, repoId), eq(repoReleases.isDraft, false));

  const releasesData = await db.select().from(repoReleases)
    .where(releaseWhere)
    .orderBy(desc(repoReleases.createdAt))
    .limit(limit + 1)
    .offset(offset)
    .all();

  const hasMore = releasesData.length > limit;
  if (hasMore) releasesData.pop();

  // Fetch assets and authors for each release
  const releases = await Promise.all(releasesData.map(async (r) => {
    const assets = await db.select().from(repoReleaseAssets)
      .where(eq(repoReleaseAssets.releaseId, r.id))
      .orderBy(asc(repoReleaseAssets.createdAt))
      .all();

    let author: { id: string; name: string; picture: string | null } | null = null;
    if (r.authorAccountId) {
      const authorData = await db.select({
        id: accounts.id,
        name: accounts.name,
        picture: accounts.picture,
      }).from(accounts).where(eq(accounts.id, r.authorAccountId)).get();
      author = authorData ?? null;
    }

    return {
      id: r.id,
      repo_id: r.repoId,
      tag: r.tag,
      name: r.name,
      description: r.description,
      commit_sha: r.commitSha,
      is_prerelease: r.isPrerelease,
      is_draft: r.isDraft,
      assets: toReleaseAssets(assets),
      author_id: r.authorAccountId,
      published_at: r.publishedAt,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      author: author ? {
        id: author.id,
        name: author.name,
        avatar_url: author.picture,
      } : null,
    };
  }));

  return c.json({
    releases,
    has_more: hasMore,
  });
  })
  .get('/repos/:repoId/releases/:tag', async (c) => {
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

  const assets = await db.select().from(repoReleaseAssets)
    .where(eq(repoReleaseAssets.releaseId, releaseData.id))
    .orderBy(asc(repoReleaseAssets.createdAt))
    .all();

  let author: { id: string; name: string; picture: string | null } | null = null;
  if (releaseData.authorAccountId) {
    const authorData = await db.select({
      id: accounts.id,
      name: accounts.name,
      picture: accounts.picture,
    }).from(accounts).where(eq(accounts.id, releaseData.authorAccountId)).get();
    author = authorData ?? null;
  }

  return c.json({
    release: {
      id: releaseData.id,
      repo_id: releaseData.repoId,
      tag: releaseData.tag,
      name: releaseData.name,
      description: releaseData.description,
      commit_sha: releaseData.commitSha,
      is_prerelease: releaseData.isPrerelease,
      is_draft: releaseData.isDraft,
      assets: toReleaseAssets(assets),
      author_id: releaseData.authorAccountId,
      published_at: releaseData.publishedAt,
      created_at: releaseData.createdAt,
      updated_at: releaseData.updatedAt,
      author: author ? {
        id: author.id,
        name: author.name,
        avatar_url: author.picture,
      } : null,
    },
  });
  })
  .post('/repos/:repoId/releases', invalidateCacheOnMutation([generateExploreInvalidationUrls]), zValidator('json', z.object({
    tag: z.string(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    commit_sha: z.string().optional(),
    is_prerelease: z.boolean().optional(),
    is_draft: z.boolean().optional(),
  })), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  if (!body.tag) {
    throw new BadRequestError('Tag is required');
  }

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  if (!hasWriteRole(repoAccess.role)) {
    throw new AuthorizationError();
  }

  const existing = await db.select({ id: repoReleases.id })
    .from(repoReleases)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, body.tag)))
    .get();

  if (existing) {
    throw new ConflictError('Release with this tag already exists');
  }

  const releaseId = generateId();
  const timestamp = now();
  const publishedAt = body.is_draft ? null : timestamp;

  await db.insert(repoReleases).values({
    id: releaseId,
    repoId,
    tag: body.tag,
    name: body.name || body.tag,
    description: body.description || null,
    commitSha: body.commit_sha || null,
    isPrerelease: !!body.is_prerelease,
    isDraft: !!body.is_draft,
    authorAccountId: user.id,
    publishedAt,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const releaseData = await fetchReleaseWithDetails(db, releaseId);

  return c.json({
    release: {
      id: releaseData?.id,
      repo_id: releaseData?.repoId,
      tag: releaseData?.tag,
      name: releaseData?.name,
      description: releaseData?.description,
      commit_sha: releaseData?.commitSha,
      is_prerelease: releaseData?.isPrerelease || false,
      is_draft: releaseData?.isDraft || false,
      assets: releaseData ? toReleaseAssets(releaseData.repoReleaseAssets) : [],
      author_id: releaseData?.authorAccountId,
      published_at: releaseData?.publishedAt,
      created_at: releaseData?.createdAt,
      updated_at: releaseData?.updatedAt,
      author: {
        id: user.id,
        name: user.name,
        avatar_url: user.picture,
      },
    },
  }, 201);
  })
  .patch('/repos/:repoId/releases/:tag', invalidateCacheOnMutation([generateExploreInvalidationUrls]), zValidator('json', z.object({
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    is_prerelease: z.boolean().optional(),
    is_draft: z.boolean().optional(),
  })), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const tag = c.req.param('tag');
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  if (!hasWriteRole(repoAccess.role)) {
    throw new AuthorizationError();
  }

  const existing = await db.select().from(repoReleases)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
    .get();

  if (!existing) {
    throw new NotFoundError('Release');
  }

  const updateData: {
    name?: string;
    description?: string | null;
    isPrerelease?: boolean;
    isDraft?: boolean;
    publishedAt?: string;
    updatedAt: string;
  } = {
    updatedAt: now(),
  };

  if (typeof body.name === 'string') {
    updateData.name = body.name;
  }
  if (body.description !== undefined) {
    updateData.description = body.description;
  }
  if (body.is_prerelease !== undefined) {
    updateData.isPrerelease = !!body.is_prerelease;
  }
  if (body.is_draft !== undefined) {
    updateData.isDraft = !!body.is_draft;
    if (existing.isDraft && !body.is_draft) {
      updateData.publishedAt = now();
    }
  }

  if (Object.keys(updateData).length === 1) {
    throw new BadRequestError('No updates provided');
  }

  await db.update(repoReleases)
    .set(updateData)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)));

  const releaseData = await db.select().from(repoReleases)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
    .get();

  const assets = releaseData
    ? await db.select().from(repoReleaseAssets)
        .where(eq(repoReleaseAssets.releaseId, releaseData.id))
        .orderBy(asc(repoReleaseAssets.createdAt))
        .all()
    : [];

  return c.json({
    release: {
      id: releaseData?.id,
      repo_id: releaseData?.repoId,
      tag: releaseData?.tag,
      name: releaseData?.name,
      description: releaseData?.description,
      commit_sha: releaseData?.commitSha,
      is_prerelease: releaseData?.isPrerelease || false,
      is_draft: releaseData?.isDraft || false,
      assets: toReleaseAssets(assets),
      author_id: releaseData?.authorAccountId,
      published_at: releaseData?.publishedAt,
      created_at: releaseData?.createdAt,
      updated_at: releaseData?.updatedAt,
    },
  });
  })
  .delete('/repos/:repoId/releases/:tag', invalidateCacheOnMutation([generateExploreInvalidationUrls]), async (c) => {
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

  const existing = await db.select({ id: repoReleases.id })
    .from(repoReleases)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
    .get();

  if (!existing) {
    throw new NotFoundError('Release');
  }

  await db.delete(repoReleases)
    .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)));

  return c.json({ deleted: true });
  })
  .get('/repos/:repoId/releases/latest', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const releaseData = await db.select().from(repoReleases)
    .where(and(
      eq(repoReleases.repoId, repoId),
      eq(repoReleases.isDraft, false),
      eq(repoReleases.isPrerelease, false),
    ))
    .orderBy(desc(repoReleases.publishedAt))
    .get();

  if (!releaseData) {
    throw new NotFoundError('Release');
  }

  const assets = await db.select().from(repoReleaseAssets)
    .where(eq(repoReleaseAssets.releaseId, releaseData.id))
    .orderBy(asc(repoReleaseAssets.createdAt))
    .all();

  let author: { id: string; name: string; picture: string | null } | null = null;
  if (releaseData.authorAccountId) {
    const authorData = await db.select({
      id: accounts.id,
      name: accounts.name,
      picture: accounts.picture,
    }).from(accounts).where(eq(accounts.id, releaseData.authorAccountId)).get();
    author = authorData ?? null;
  }

  return c.json({
    release: {
      id: releaseData.id,
      repo_id: releaseData.repoId,
      tag: releaseData.tag,
      name: releaseData.name,
      description: releaseData.description,
      commit_sha: releaseData.commitSha,
      is_prerelease: false,
      is_draft: false,
      assets: toReleaseAssets(assets),
      author_id: releaseData.authorAccountId,
      published_at: releaseData.publishedAt,
      created_at: releaseData.createdAt,
      updated_at: releaseData.updatedAt,
      author: author ? {
        id: author.id,
        name: author.name,
        avatar_url: author.picture,
      } : null,
    },
  });
  })
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

  let bundleFormat: string | undefined;
  let bundleMeta: ReleaseAsset['bundle_meta'] | undefined;

  if (fileNameLower.endsWith('.takopack')) {
    try {
      const manifest = await parseManifestOnly(fileData);
      bundleFormat = 'takopack';
      bundleMeta = {
        name: manifest.meta?.name,
        app_id: manifest.meta?.appId,
        version: manifest.meta?.version || '0.0.0',
        description: manifest.meta?.description,
        icon: manifest.meta?.icon,
        category: manifest.meta?.category,
        tags: Array.isArray(manifest.meta?.tags)
          ? manifest.meta.tags.map((t: unknown) => String(t || '').trim()).filter(Boolean).map((t: string) => t.toLowerCase())
          : undefined,
        dependencies: Array.isArray(manifest.dependencies)
          ? manifest.dependencies
              .map((d: Record<string, unknown>) => ({ repo: String(d?.repo || '').trim(), version: String(d?.version || '').trim() }))
              .filter((d: { repo: string; version: string }) => d.repo && d.version)
          : undefined,
      };
    } catch (e) {
      // Not a valid takopack - log for diagnostics but continue upload
      logWarn('Failed to parse takopack manifest', { module: 'releases', error: e instanceof Error ? e.message : String(e) });
    }
  }

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
