import { Hono } from 'hono';
import { z } from 'zod';
import { parsePagination, paginatedResponse } from '../../../shared/utils/index.ts';
import { fetchProfileActivity } from '../../../application/services/identity/profile-activity.ts';
import { type OptionalAuthRouteEnv } from '../route-auth.ts';
import { zValidator } from '../zod-validator.ts';
import { NotFoundError, AuthorizationError, BadRequestError } from 'takos-common/errors';
import { batchStarCheck, getUserByUsername, getUserPrivacySettings, getUserStats, isFollowing } from './profile-queries.ts';
import { getDb } from '../../../infra/db/index.ts';
import { accounts, repositories, repoStars } from '../../../infra/db/schema.ts';
import { eq, and, desc, asc, count } from 'drizzle-orm';
import { getBlockFlags, isMutedByViewer, hasPendingFollowRequest } from './block-follow-utils.ts';
import type { UserProfileResponse, ProfileRepoResponse } from './dto.ts';
import { textDate } from '../../../shared/utils/db-guards.ts';

export const profileCrudRoutes = new Hono<OptionalAuthRouteEnv>()

.get('/:username', async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }

  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  const stats = await getUserStats(c.env.DB, profileUser.id);
  const isSelf = !!currentUser && currentUser.id === profileUser.id;
  const privacy = await getUserPrivacySettings(c.env.DB, profileUser.id);
  const following = await isFollowing(c.env.DB, currentUser?.id, profileUser.id);
  const followRequested = !isSelf && !following
    ? await hasPendingFollowRequest(db, currentUser?.id, profileUser.id)
    : false;
  const muted = !isSelf ? await isMutedByViewer(db, currentUser?.id, profileUser.id) : false;

  const profile: UserProfileResponse = {
    username: profileUser.username || username,
    name: profileUser.name,
    bio: profileUser.bio,
    picture: profileUser.picture,
    public_repo_count: stats.public_repo_count,
    followers_count: stats.followers_count,
    following_count: stats.following_count,
    is_self: isSelf,
    private_account: privacy.private_account,
    is_following: following,
    follow_requested: followRequested,
    is_blocking: blockFlags.is_blocking,
    is_muted: muted,
    created_at: profileUser.created_at,
  };

  return c.json({ user: profile });
})

.get('/:username/repos',
  zValidator('query', z.object({
    limit: z.string().optional(),
    offset: z.string().optional(),
    sort: z.string().optional(),
    order: z.string().optional(),
  })),
  async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const { sort: sortRaw, order: orderRaw, ...paginationRaw } = c.req.valid('query');
  const { limit, offset } = parsePagination(paginationRaw);
  const sort = sortRaw || 'updated';
  const order = orderRaw || 'desc';
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }
  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  const ALLOWED_SORT_COLUMNS = {
    'updated': repositories.updatedAt,
    'stars': repositories.stars,
    'name': repositories.name,
  } as const;
  const orderByColumn = ALLOWED_SORT_COLUMNS[sort as keyof typeof ALLOWED_SORT_COLUMNS] || ALLOWED_SORT_COLUMNS['updated'];
  const orderByClause = order.toLowerCase() === 'asc' ? asc(orderByColumn) : desc(orderByColumn);

  const repoWhere = and(
    eq(repositories.accountId, profileUser.id),
    eq(repositories.visibility, 'public'),
  );

  const totalResult = await db.select({ count: count() }).from(repositories).where(repoWhere).get();
  const total = totalResult?.count ?? 0;

  const reposData = await db.select().from(repositories)
    .where(repoWhere)
    .orderBy(orderByClause)
    .limit(limit)
    .offset(offset)
    .all();

  const starredSet = await batchStarCheck(c.env.DB, currentUser?.id, reposData.map((r) => r.id));

  const repos: ProfileRepoResponse[] = reposData.map((repo) => ({
    owner_username: profileUser.username || username,
    name: repo.name,
    description: repo.description,
    visibility: repo.visibility as 'public' | 'private',
    default_branch: repo.defaultBranch,
    stars: repo.stars,
    forks: repo.forks,
    is_starred: starredSet.has(repo.id),
    updated_at: textDate(repo.updatedAt),
  }));

  const { items, ...pagination } = paginatedResponse(repos, total, { limit, offset });
  return c.json({
    repos: items,
    ...pagination,
  });
})

.get('/:username/stars',

  zValidator('query', z.object({
    limit: z.string().optional(),
    offset: z.string().optional(),
  })),
  async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const { limit, offset } = parsePagination(c.req.valid('query'));
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }
  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  // Count stars with public repos using a join
  const totalResult = await db.select({ count: count() })
    .from(repoStars)
    .innerJoin(repositories, eq(repoStars.repoId, repositories.id))
    .where(and(
      eq(repoStars.accountId, profileUser.id),
      eq(repositories.visibility, 'public'),
    ))
    .get();
  const total = totalResult?.count ?? 0;

  // Query stars with joined repo and account data
  const starsData = await db.select({
    starAccountId: repoStars.accountId,
    starRepoId: repoStars.repoId,
    starCreatedAt: repoStars.createdAt,
    repoId: repositories.id,
    repoName: repositories.name,
    repoDescription: repositories.description,
    repoVisibility: repositories.visibility,
    repoDefaultBranch: repositories.defaultBranch,
    repoStars: repositories.stars,
    repoForks: repositories.forks,
    repoUpdatedAt: repositories.updatedAt,
    repoAccountId: repositories.accountId,
    ownerSlug: accounts.slug,
  })
    .from(repoStars)
    .innerJoin(repositories, eq(repoStars.repoId, repositories.id))
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(
      eq(repoStars.accountId, profileUser.id),
      eq(repositories.visibility, 'public'),
    ))
    .orderBy(desc(repoStars.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  // Filter valid entries and batch star-check
  const validStars = starsData.filter((sd) => !!sd.ownerSlug);
  const starRepoIds = validStars.map((sd) => sd.repoId);

  // Viewing own stars page — all are starred; otherwise batch-check
  const starredSet = (currentUser && currentUser.id === profileUser.id)
    ? new Set(starRepoIds)
    : await batchStarCheck(c.env.DB, currentUser?.id, starRepoIds);

  const repos: (ProfileRepoResponse & { starred_at: string })[] = validStars.map((starData) => {
    return {
      owner_username: starData.ownerSlug!,
      name: starData.repoName,
      description: starData.repoDescription,
      visibility: starData.repoVisibility as 'public' | 'private',
      default_branch: starData.repoDefaultBranch,
      stars: starData.repoStars,
      forks: starData.repoForks,
      is_starred: starredSet.has(starData.repoId),
      updated_at: textDate(starData.repoUpdatedAt),
      starred_at: textDate(starData.starCreatedAt),
    };
  });

  const { items, ...pagination } = paginatedResponse(repos, total, { limit, offset });
  return c.json({
    repos: items,
    ...pagination,
  });
})

.get('/:username/activity',
  zValidator('query', z.object({
    limit: z.string().optional(),
    before: z.string().optional(),
  })),
  async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }

  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  const privacy = await getUserPrivacySettings(c.env.DB, profileUser.id);
  const isSelf = !!currentUser && currentUser.id === profileUser.id;
  if (privacy.activity_visibility === 'private' && !isSelf) {
    throw new AuthorizationError('Activity is private');
  }
  if (privacy.activity_visibility === 'followers' && !isSelf) {
    const following = await isFollowing(c.env.DB, currentUser?.id, profileUser.id);
    if (!following) {
      throw new AuthorizationError('Activity is visible to followers only');
    }
  }

  const { limit: limitRaw, before: beforeRaw } = c.req.valid('query');
  const { limit } = parsePagination({ limit: limitRaw }, { maxLimit: 50 });

  let before: string | null = null;
  if (beforeRaw) {
    const v = String(beforeRaw);
    if (!Number.isFinite(Date.parse(v))) {
      throw new BadRequestError('Invalid before');
    }
    before = v;
  }

  const result = await fetchProfileActivity(c.env.DB, {
    profileUserId: profileUser.id,
    profileUserEmail: profileUser.email,
    limit,
    before,
  });

  return c.json(result);
});
