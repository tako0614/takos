import { Hono } from 'hono';
import { z } from 'zod';
import { generateId, now } from '../../../shared/utils';
import { parseLimit, parseOffset } from '../shared/route-auth';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import { checkRepoAccess } from '../../../application/services/source/repos';
import { generateExploreInvalidationUrls, hasWriteRole } from './routes';
import { getDb } from '../../../infra/db';
import { repoReleases, repoReleaseAssets, accounts } from '../../../infra/db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { invalidateCacheOnMutation } from '../../middleware/cache';
import { toReleaseAssets } from '../../../application/services/source/repo-release-assets';
import { BadRequestError, AuthorizationError, NotFoundError, ConflictError } from '@takos/common/errors';
import { fetchReleaseWithDetails } from './release-shared';

const releaseCrud = new Hono<AuthenticatedRouteEnv>()
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
  });

export default releaseCrud;
