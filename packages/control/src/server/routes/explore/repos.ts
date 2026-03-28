import { Hono } from 'hono';
import type { Env, User } from '../../../shared/types';
import {
  listExploreRepos,
  listTrendingRepos,
  listNewRepos,
  listRecentRepos,
} from '../../../application/services/source/explore';
import { withCache, CacheTTL, CacheTags } from '../../middleware/cache';
import { getDb } from '../../../infra/db';
import { accounts, repositories, repoStars } from '../../../infra/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { checkRepoAccess } from '../../../application/services/source/repos';
import { parseLimit, parseOffset } from '../route-auth';
import { NotFoundError } from 'takos-common/errors';
import {
  findRepoByUsernameAndName,
  parseExploreFilters,
  validateExploreFilters,
} from './explore-filters';

type Variables = {
  user?: User;
};

export default new Hono<{ Bindings: Env; Variables: Variables }>()
  .get('/repos', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['sort', 'order', 'limit', 'offset', 'q', 'category', 'language', 'license', 'since'],
  }), async (c) => {
    const user = c.get('user');
    const filters = parseExploreFilters(c);
    validateExploreFilters(c, filters);

    const response = await listExploreRepos(c.env.DB, {
      sort: c.req.query('sort') || 'stars',
      order: c.req.query('order') || 'desc',
      limit: parseLimit(c.req.query('limit'), 20, 100),
      offset: parseOffset(c.req.query('offset')),
      searchQuery: c.req.query('q')?.trim() || '',
      ...filters,
      userId: user?.id,
    });

    return c.json(response);
  })
  .get('/repos/trending', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['limit', 'offset', 'category', 'language', 'license', 'since'],
  }), async (c) => {
    const user = c.get('user');
    const filters = parseExploreFilters(c);
    validateExploreFilters(c, filters);

    const response = await listTrendingRepos(c.env.DB, {
      limit: parseLimit(c.req.query('limit'), 20, 100),
      offset: parseOffset(c.req.query('offset')),
      ...filters,
      userId: user?.id,
    });

    return c.json(response);
  })
  .get('/repos/new', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['limit', 'offset', 'category', 'language', 'license', 'since'],
  }), async (c) => {
    const user = c.get('user');
    const filters = parseExploreFilters(c);
    validateExploreFilters(c, filters);

    const response = await listNewRepos(c.env.DB, {
      limit: parseLimit(c.req.query('limit'), 20, 100),
      offset: parseOffset(c.req.query('offset')),
      ...filters,
      userId: user?.id,
    });

    return c.json(response);
  })
  .get('/repos/recent', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['limit', 'offset', 'category', 'language', 'license', 'since'],
  }), async (c) => {
    const user = c.get('user');
    const filters = parseExploreFilters(c);
    validateExploreFilters(c, filters);

    const response = await listRecentRepos(c.env.DB, {
      limit: parseLimit(c.req.query('limit'), 20, 100),
      offset: parseOffset(c.req.query('offset')),
      ...filters,
      userId: user?.id,
    });

    return c.json(response);
  })
  .get('/repos/by-name/:username/:repoName', async (c) => {
    const user = c.get('user');
    const username = c.req.param('username');
    const repoName = c.req.param('repoName');
    const db = getDb(c.env.DB);

    const repo = await findRepoByUsernameAndName(db, username, repoName);

    if (!repo) {
      throw new NotFoundError('Repository');
    }

    if (repo.visibility !== 'public') {
      if (!user) {
        throw new NotFoundError('Repository');
      }

      const repoAccess = await checkRepoAccess(c.env, repo.id, user.id);
      if (!repoAccess) {
        throw new NotFoundError('Repository');
      }
    }

    let isStarred = false;
    if (user) {
      const star = await db.select().from(repoStars).where(
        and(eq(repoStars.accountId, user.id), eq(repoStars.repoId, repo.id))
      ).get();
      isStarred = !!star;
    }

    return c.json({
      repository: {
        id: repo.id,
        name: repo.name,
        description: repo.description,
        visibility: repo.visibility,
        default_branch: repo.default_branch,
        stars: repo.stars,
        forks: repo.forks,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
      },
      workspace: {
        id: repo.space_id,
        name: repo.workspace_name,
      },
      owner: {
        id: repo.owner_id,
        name: repo.owner_name,
        username: repo.owner_username,
        avatar_url: repo.owner_avatar_url,
      },
      is_starred: isStarred,
    });
  })
  .get('/repos/:id', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('id');
    const db = getDb(c.env.DB);

    const result = await db.select({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      visibility: repositories.visibility,
      defaultBranch: repositories.defaultBranch,
      stars: repositories.stars,
      forks: repositories.forks,
      createdAt: repositories.createdAt,
      updatedAt: repositories.updatedAt,
      accountId: accounts.id,
      accountSlug: accounts.slug,
      accountName: accounts.name,
      accountPicture: accounts.picture,
    }).from(repositories)
      .leftJoin(accounts, eq(repositories.accountId, accounts.id))
      .where(and(eq(repositories.id, repoId), eq(repositories.visibility, 'public')))
      .get();

    if (!result) {
      throw new NotFoundError('Repository');
    }

    let isStarred = false;
    if (user) {
      const star = await db.select().from(repoStars).where(
        and(eq(repoStars.accountId, user.id), eq(repoStars.repoId, repoId))
      ).get();
      isStarred = !!star;
    }

    return c.json({
      repository: {
        id: result.id,
        name: result.name,
        description: result.description,
        visibility: result.visibility,
        default_branch: result.defaultBranch,
        stars: result.stars,
        forks: result.forks,
        created_at: result.createdAt,
        updated_at: result.updatedAt,
      },
      workspace: {
        id: result.accountId,
        name: result.accountName,
      },
      owner: {
        id: result.accountId,
        name: result.accountName,
        username: result.accountSlug || result.accountId,
        avatar_url: result.accountPicture,
      },
      is_starred: isStarred,
    });
  });
