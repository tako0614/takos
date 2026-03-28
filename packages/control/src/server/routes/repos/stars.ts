import { Hono } from 'hono';
import { now, toIsoString } from '../../../shared/utils';
import { checkRepoAccess } from '../../../application/services/source/repos';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { generateExploreInvalidationUrls } from './routes';
import { getDb } from '../../../infra/db';
import { repoStars, repositories, accounts } from '../../../infra/db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { invalidateCacheOnMutation } from '../../middleware/cache';
import { parseLimit, parseOffset } from '../shared/route-auth';
import { BadRequestError, AuthenticationError, NotFoundError } from '@takoserver/common/errors';

export default new Hono<AuthenticatedRouteEnv>()
  .post('/repos/:repoId/star', invalidateCacheOnMutation([generateExploreInvalidationUrls]), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const timestamp = now();

  const existingStar = await db.select()
    .from(repoStars)
    .where(and(
      eq(repoStars.accountId, user.id),
      eq(repoStars.repoId, repoId),
    ))
    .get();

  if (existingStar) {
    throw new BadRequestError('Already starred');
  }

  // Use onConflictDoNothing to handle race conditions safely
  const insertResult = await db.insert(repoStars)
    .values({
      accountId: user.id,
      repoId,
      createdAt: timestamp,
    })
    .onConflictDoNothing()
    .returning({ accountId: repoStars.accountId });

  if (insertResult.length > 0) {
    await db.update(repositories)
      .set({ stars: sql`${repositories.stars} + 1` })
      .where(eq(repositories.id, repoId));
  }

  return c.json({ starred: true });
  })
  .delete('/repos/:repoId/star', invalidateCacheOnMutation([generateExploreInvalidationUrls]), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const existingStar = await db.select()
    .from(repoStars)
    .where(and(
      eq(repoStars.accountId, user.id),
      eq(repoStars.repoId, repoId),
    ))
    .get();

  if (!existingStar) {
    throw new BadRequestError('Not starred');
  }

  const repo = await db.select({ stars: repositories.stars })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .get();

  // Use Drizzle delete with returning to get affected count
  const deleteResult = await db.delete(repoStars)
    .where(and(
      eq(repoStars.accountId, user.id),
      eq(repoStars.repoId, repoId),
    ))
    .returning({ accountId: repoStars.accountId });

  if (deleteResult.length > 0 && repo && repo.stars > 0) {
    await db.update(repositories)
      .set({ stars: sql`${repositories.stars} - 1` })
      .where(eq(repositories.id, repoId));
  }

  return c.json({ starred: false });
  })
  .get('/repos/starred', async (c) => {
  const user = c.get('user');
  if (!user) {
    throw new AuthenticationError();
  }
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const offset = parseOffset(c.req.query('offset'));
  const db = getDb(c.env.DB);

  // Query stars with joined repo and account data
  const starsQuery = db.select({
    starCreatedAt: repoStars.createdAt,
    repoId: repositories.id,
    repoName: repositories.name,
    repoDescription: repositories.description,
    repoVisibility: repositories.visibility,
    repoDefaultBranch: repositories.defaultBranch,
    repoStars: repositories.stars,
    repoForks: repositories.forks,
    repoCreatedAt: repositories.createdAt,
    repoUpdatedAt: repositories.updatedAt,
    accountId: accounts.id,
    accountName: accounts.name,
    accountSlug: accounts.slug,
    accountPicture: accounts.picture,
  })
    .from(repoStars)
    .innerJoin(repositories, eq(repoStars.repoId, repositories.id))
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(eq(repoStars.accountId, user.id))
    .orderBy(desc(repoStars.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const totalQuery = db.select({ count: sql<number>`count(*)` })
    .from(repoStars)
    .where(eq(repoStars.accountId, user.id));

  const [stars, totalResult] = await Promise.all([
    starsQuery.all(),
    totalQuery.get(),
  ]);
  const total = totalResult?.count ?? 0;

  const hasMore = stars.length > limit;
  if (hasMore) stars.pop();

  return c.json({
    repos: stars.map((star) => {
      const ownerUsername = star.accountSlug || star.accountId;

      return {
      id: star.repoId,
      name: star.repoName,
      description: star.repoDescription,
      visibility: star.repoVisibility,
      default_branch: star.repoDefaultBranch,
      stars: star.repoStars,
      forks: star.repoForks,
      is_starred: true,
      created_at: toIsoString(star.repoCreatedAt),
      updated_at: toIsoString(star.repoUpdatedAt),
      workspace: {
        id: star.accountId,
        name: star.accountName,
      },
      owner: {
        id: star.accountId,
        name: star.accountName,
        username: ownerUsername,
        avatar_url: star.accountPicture || null,
      },
    };
    }),
    has_more: hasMore,
    total,
  });
  })
  .get('/repos/:repoId/star', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  if (!user?.id) {
    return c.json({ starred: false });
  }

  const star = await db.select({ accountId: repoStars.accountId })
    .from(repoStars)
    .where(and(
      eq(repoStars.accountId, user.id),
      eq(repoStars.repoId, repoId),
    ))
    .get();

  return c.json({ starred: !!star });
  });
