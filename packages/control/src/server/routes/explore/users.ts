import { Hono } from 'hono';
import type { Env, User } from '../../../shared/types/index.ts';
import { withCache, CacheTTL, CacheTags } from '../../middleware/cache.ts';
import { getDb } from '../../../infra/db/index.ts';
import { accounts, repositories, repoStars } from '../../../infra/db/schema.ts';
import { eq, and, or, desc, asc, like, inArray, count } from 'drizzle-orm';
import { parsePagination } from '../../../shared/utils/index.ts';
import { NotFoundError } from 'takos-common/errors';

type Variables = {
  user?: User;
};

export default new Hono<{ Bindings: Env; Variables: Variables }>()
  // User/Workspace Discovery API
  .get('/users', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['q', 'limit', 'offset'],
  }), async (c) => {
    const { ne } = await import('drizzle-orm');
    const db = getDb(c.env.DB);
    const searchQuery = c.req.query('q')?.trim() || '';
    const { limit, offset } = parsePagination(c.req.query());

    const conditions = [ne(accounts.slug, '')];
    if (searchQuery) {
      conditions.push(or(like(accounts.slug, `%${searchQuery}%`), like(accounts.name, `%${searchQuery}%`))!);
    }

    const users = await db.select({
      id: accounts.id,
      slug: accounts.slug,
      name: accounts.name,
      picture: accounts.picture,
    }).from(accounts)
      .where(and(...conditions))
      .orderBy(asc(accounts.slug))
      .limit(limit + 1)
      .offset(offset)
      .all();

    const paginatedUsers = users.slice(0, limit).filter(u => u.slug);
    const userIds = paginatedUsers.map(u => u.id);

    // Batch query: get public repo counts for all users at once
    const repoCounts = userIds.length > 0
      ? await db.select({
          accountId: repositories.accountId,
          count: count(),
        }).from(repositories)
          .where(and(eq(repositories.visibility, 'public'), inArray(repositories.accountId, userIds)))
          .groupBy(repositories.accountId)
          .all()
      : [];

    const repoCountMap = new Map(repoCounts.map(r => [r.accountId, r.count]));

    const usersWithRepoCount = paginatedUsers
      .map(user => {
        const cnt = repoCountMap.get(user.id) ?? 0;
        if (cnt > 0) {
          return {
            username: user.slug as string,
            name: user.name,
            avatar_url: user.picture,
            public_repo_count: cnt,
          };
        }
        return null;
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);

    const hasMore = users.length > limit;

    return c.json({
      users: usersWithRepoCount,
      has_more: hasMore,
    });
  })
  .get('/users/:username', async (c) => {
    const currentUser = c.get('user');
    const username = c.req.param('username').toLowerCase();
    const db = getDb(c.env.DB);

    const user = await db.select({
      id: accounts.id,
      slug: accounts.slug,
      name: accounts.name,
      picture: accounts.picture,
      bio: accounts.bio,
    }).from(accounts).where(eq(accounts.slug, username)).get();

    if (!user) {
      throw new NotFoundError('User');
    }

    const repos = await db.select({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      visibility: repositories.visibility,
      stars: repositories.stars,
      forks: repositories.forks,
      createdAt: repositories.createdAt,
      updatedAt: repositories.updatedAt,
      accountId: accounts.id,
      accountName: accounts.name,
      accountSlug: accounts.slug,
    }).from(repositories)
      .leftJoin(accounts, eq(repositories.accountId, accounts.id))
      .where(and(eq(repositories.visibility, 'public'), eq(repositories.accountId, user.id)))
      .orderBy(desc(repositories.stars))
      .all();

    let starredRepoIds: Set<string> = new Set();
    if (currentUser && repos.length > 0) {
      const stars = await db.select({ repoId: repoStars.repoId }).from(repoStars).where(
        and(eq(repoStars.accountId, currentUser.id), inArray(repoStars.repoId, repos.map(r => r.id)))
      ).all();
      starredRepoIds = new Set(stars.map(s => s.repoId));
    }

    return c.json({
      user: {
        username: user.slug,
        name: user.name,
        avatar_url: user.picture,
        bio: user.bio,
      },
      repositories: repos.map(repo => ({
        id: repo.id,
        name: repo.name,
        description: repo.description,
        visibility: repo.visibility,
        stars: repo.stars,
        forks: repo.forks,
        created_at: repo.createdAt,
        updated_at: repo.updatedAt,
        workspace: {
          slug: repo.accountSlug || repo.accountId,
          name: repo.accountName,
        },
        owner: {
          username: user.slug,
          name: user.name,
          avatar_url: user.picture,
        },
        is_starred: starredRepoIds.has(repo.id),
      })),
    });
  });
