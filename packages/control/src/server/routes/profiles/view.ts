import { Hono } from 'hono';
import type { ProfileRepoResponse, UserProfileResponse } from './api';
import { batchStarCheck, getUserByUsername, getUserStats, isFollowing } from './profile-queries';
import { getDb } from '../../../infra/db';
import { repositories, repoStars, accounts } from '../../../infra/db/schema';
import { eq, and, desc, asc, count } from 'drizzle-orm';
import { toIsoString } from '../../../shared/utils';
import { parseLimit, parseOffset, type OptionalAuthRouteEnv } from '../shared/route-auth';
import { NotFoundError } from '@takos/common/errors';

const profilesView = new Hono<OptionalAuthRouteEnv>();

profilesView.get(':username', async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }

  const stats = await getUserStats(c.env.DB, profileUser.id);
  const following = await isFollowing(c.env.DB, currentUser?.id, profileUser.id);

  const reposData = await db.select().from(repositories)
    .where(and(
      eq(repositories.accountId, profileUser.id),
      eq(repositories.visibility, 'public'),
    ))
    .orderBy(desc(repositories.updatedAt))
    .limit(6)
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
    updated_at: toIsoString(repo.updatedAt),
  }));

  const isSelf = !!currentUser && currentUser.id === profileUser.id;

  const profile: UserProfileResponse = {
    username: profileUser.username,
    name: profileUser.name,
    bio: profileUser.bio,
    picture: profileUser.picture,
    public_repo_count: stats.public_repo_count,
    followers_count: stats.followers_count,
    following_count: stats.following_count,
    is_self: isSelf,
    private_account: false,
    is_following: following,
    follow_requested: false,
    is_blocking: false,
    is_muted: false,
    created_at: profileUser.created_at,
  };

  return c.json({
    profile,
    recent_repos: repos,
  });
});

profilesView.get('/:username/repos', async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const offset = parseOffset(c.req.query('offset'));
  const sort = c.req.query('sort') || 'updated';
  const order = c.req.query('order') || 'desc';
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
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
    updated_at: toIsoString(repo.updatedAt),
  }));

  return c.json({
    repos,
    total,
    has_more: offset + repos.length < total,
  });
});

profilesView.get('/:username/stars', async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const offset = parseOffset(c.req.query('offset'));
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
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
      updated_at: toIsoString(starData.repoUpdatedAt),
      starred_at: toIsoString(starData.starCreatedAt),
    };
  });

  return c.json({
    repos,
    total,
    has_more: offset + repos.length < total,
  });
});

export default profilesView;
