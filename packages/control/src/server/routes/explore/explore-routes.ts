import { Hono } from 'hono';
import type { Env, User } from '../../../shared/types';
import {
  listExploreRepos,
  listTrendingRepos,
  listNewRepos,
  listRecentRepos,
  listCatalogItems,
} from '../../../application/services/source/explore';
import {
  searchPackages,
  suggestPackages,
  getTakopackRatingStats,
  getTakopackRatingSummary,
} from '../../../application/services/source/explore-packages';
import { withCache, CacheTTL, CacheTags } from '../../middleware/cache';
import { checkSpaceAccess } from '../../../shared/utils';
import { getDb } from '../../../infra/db';
import { accounts, repositories, repoStars, repoReleases, repoReleaseAssets } from '../../../infra/db/schema';
import { eq, and, or, desc, asc, like, inArray, sql, count } from 'drizzle-orm';
import { checkRepoAccess } from '../../../application/services/source/repos';
import { toReleaseAssets } from '../../../application/services/source/repo-release-assets';
import { badRequest, unauthorized, forbidden, notFound, errorResponse, parseLimit, parseOffset, type AnyAppContext } from '../shared/route-auth';
import {
  buildCatalogSuggestions,
  EXPLORE_CATEGORIES,
  findRepoByUsernameAndName,
  normalizeSimpleFilter,
  parseExploreFilters,
  validateExploreFilters,
  type ReleaseAsset,
} from './explore-filters';
import { ERR } from '../../../shared/constants';

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
    const filterError = validateExploreFilters(c, filters);
    if (filterError) return filterError;

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
    const filterError = validateExploreFilters(c, filters);
    if (filterError) return filterError;

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
    const filterError = validateExploreFilters(c, filters);
    if (filterError) return filterError;

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
    const filterError = validateExploreFilters(c, filters);
    if (filterError) return filterError;

    const response = await listRecentRepos(c.env.DB, {
      limit: parseLimit(c.req.query('limit'), 20, 100),
      offset: parseOffset(c.req.query('offset')),
      ...filters,
      userId: user?.id,
    });

    return c.json(response);
  })
  .get('/catalog', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: [
      'q',
      'sort',
      'type',
      'category',
      'language',
      'license',
      'since',
      'tags',
      'certified_only',
      'space_id',
      'limit',
      'offset',
    ],
  }), async (c) => {
    const user = c.get('user');
    const filters = parseExploreFilters(c);
    const filterError = validateExploreFilters(c, filters);
    if (filterError) return filterError;

    const sortRaw = (c.req.query('sort') || 'trending').trim().toLowerCase();
    const sort = (
      sortRaw === 'trending' ||
      sortRaw === 'new' ||
      sortRaw === 'stars' ||
      sortRaw === 'updated' ||
      sortRaw === 'downloads'
    ) ? sortRaw : null;
    if (!sort) {
      return badRequest(c, 'Invalid sort');
    }

    const typeRaw = (c.req.query('type') || 'all').trim().toLowerCase();
    const normalizedCatalogType = typeRaw === 'deployable-app' ? 'deployable-app' : typeRaw;
    const catalogType = (
      normalizedCatalogType === 'all'
      || normalizedCatalogType === 'repo'
      || normalizedCatalogType === 'deployable-app'
    )
      ? normalizedCatalogType
      : null;
    if (!catalogType) {
      return badRequest(c, 'Invalid type');
    }

    const spaceIdRaw = c.req.query('space_id')?.trim();
    let resolvedSpaceId: string | undefined;
    if (spaceIdRaw) {
      if (!user) {
        return unauthorized(c, 'Authentication required for space_id');
      }
      const access = await checkSpaceAccess(c.env.DB, spaceIdRaw, user.id);
      if (!access) {
        return forbidden(c, 'Workspace access denied');
      }
      resolvedSpaceId = access.space.id;
    }

    const tagsRaw = c.req.query('tags');
    const tags = (tagsRaw || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
    for (const tag of tags) {
      if (tag.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
        return badRequest(c, 'Invalid tags (expected comma-separated tag slugs)');
      }
    }

    const result = await listCatalogItems(c.env.DB, {
      sort,
      type: catalogType,
      limit: parseLimit(c.req.query('limit'), 20, 50),
      offset: parseOffset(c.req.query('offset')),
      searchQuery: c.req.query('q')?.trim() || '',
      ...filters,
      tagsRaw,
      certifiedOnly: c.req.query('certified_only') === 'true',
      spaceId: resolvedSpaceId,
      userId: user?.id,
    });

    return c.json(result);
  })
  .get('/suggest', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['q', 'limit'],
  }), async (c) => {
    const db = getDb(c.env.DB);
    const q = c.req.query('q')?.trim() || '';
    const limit = parseLimit(c.req.query('limit'), 8, 20);

    if (!q) {
      return c.json({ users: [], repos: [] });
    }

    const suggestions = await buildCatalogSuggestions(db, q, limit);
    return c.json(suggestions);
  })
  .get('/catalog/suggest', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['q', 'limit'],
  }), async (c) => {
    const db = getDb(c.env.DB);
    const q = c.req.query('q')?.trim() || '';
    const limit = parseLimit(c.req.query('limit'), 8, 20);

    if (!q) {
      return c.json({ users: [], repos: [] });
    }

    const suggestions = await buildCatalogSuggestions(db, q, limit);
    return c.json(suggestions);
  })
  .get('/repos/by-name/:username/:repoName', async (c) => {
    const user = c.get('user');
    const username = c.req.param('username');
    const repoName = c.req.param('repoName');
    const db = getDb(c.env.DB);

    const repo = await findRepoByUsernameAndName(db, username, repoName);

    if (!repo) {
      return notFound(c, 'Repository');
    }

    if (repo.visibility !== 'public') {
      if (!user) {
        return notFound(c, 'Repository');
      }

      const repoAccess = await checkRepoAccess(c.env, repo.id, user.id);
      if (!repoAccess) {
        return notFound(c, 'Repository');
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
      return notFound(c, 'Repository');
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
  })
  // Package Registry API
  .get('/packages', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['q', 'category', 'tags', 'certified_only', 'sort', 'limit', 'offset'],
  }), async (c) => {
    const sortParamRaw = (c.req.query('sort') || 'popular').trim().toLowerCase();
    const category = normalizeSimpleFilter(c.req.query('category'), { maxLen: 32, pattern: /^[a-z0-9_-]+$/ });
    const tagsRaw = c.req.query('tags');

    if (category && !(EXPLORE_CATEGORIES as ReadonlyArray<string>).includes(category)) {
      return badRequest(c, 'Invalid category');
    }

    const tags = (tagsRaw || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
    for (const t of tags) {
      if (t.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(t)) {
        return badRequest(c, 'Invalid tags (expected comma-separated tag slugs)');
      }
    }

    const result = await searchPackages(c.env.DB, {
      searchQuery: c.req.query('q')?.trim() || '',
      sortParamRaw,
      limit: parseLimit(c.req.query('limit'), 20, 100),
      offset: parseOffset(c.req.query('offset')),
      category,
      tags,
      certifiedOnly: c.req.query('certified_only') === 'true',
    });

    return c.json(result);
  })
  .get('/packages/suggest', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['q', 'category', 'tags', 'limit'],
  }), async (c) => {
    const q = c.req.query('q')?.trim() || '';
    const limit = parseLimit(c.req.query('limit'), 10, 20);
    const category = normalizeSimpleFilter(c.req.query('category'), { maxLen: 32, pattern: /^[a-z0-9_-]+$/ });
    const tagsRaw = c.req.query('tags');

    if (!q) {
      return c.json({ packages: [] });
    }

    if (category && !(EXPLORE_CATEGORIES as ReadonlyArray<string>).includes(category)) {
      return badRequest(c, 'Invalid category');
    }

    const tags = (tagsRaw || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
    for (const t of tags) {
      if (t.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(t)) {
        return badRequest(c, 'Invalid tags (expected comma-separated tag slugs)');
      }
    }

    const packages = await suggestPackages(c.env.DB, { query: q, limit, category, tags });
    return c.json({ packages });
  })
  .get('/packages/:username/:repoName/latest', async (c) => {
    const username = c.req.param('username');
    const repoName = c.req.param('repoName');
    const db = getDb(c.env.DB);

    const repo = await findRepoByUsernameAndName(db, username, repoName);

    if (!repo || repo.visibility !== 'public') {
      return notFound(c, 'Repository');
    }

    const releaseRows = await db.select().from(repoReleases).where(
      and(eq(repoReleases.repoId, repo.id), eq(repoReleases.isDraft, false), eq(repoReleases.isPrerelease, false))
    ).orderBy(desc(repoReleases.publishedAt)).limit(10).all();

    // Load assets for each release
    const releaseIds = releaseRows.map(r => r.id);
    const allAssets = releaseIds.length > 0
      ? await db.select().from(repoReleaseAssets).where(inArray(repoReleaseAssets.releaseId, releaseIds)).orderBy(asc(repoReleaseAssets.createdAt)).all()
      : [];
    const assetsByRelease = new Map<string, typeof allAssets>();
    for (const asset of allAssets) {
      const list = assetsByRelease.get(asset.releaseId) ?? [];
      list.push(asset);
      assetsByRelease.set(asset.releaseId, list);
    }
    const releases = releaseRows.map(r => ({
      ...r,
      repoReleaseAssets: assetsByRelease.get(r.id) ?? [],
    }));

    let latestPackage: {
      release: typeof releases[0];
      asset: ReleaseAsset;
    } | null = null;

    for (const release of releases) {
      const assets = toReleaseAssets(release.repoReleaseAssets);
      const takopackAsset = assets.find((a) => a.bundle_format === 'takopack');
      if (takopackAsset) {
        latestPackage = { release, asset: takopackAsset };
        break;
      }
    }

    if (!latestPackage) {
      return notFound(c, 'Takopack release');
    }

    const rating = await getTakopackRatingSummary(db, repo.id);

    return c.json({
      package: {
        name: repo.name,
        app_id: latestPackage.asset.bundle_meta?.app_id || latestPackage.asset.bundle_meta?.name || repo.name,
        version: latestPackage.asset.bundle_meta?.version || latestPackage.release.tag,
        description: latestPackage.asset.bundle_meta?.description || latestPackage.release.description,
        icon: latestPackage.asset.bundle_meta?.icon,
        repository: {
          id: repo.id,
          name: repo.name,
          description: repo.description,
          stars: repo.stars,
        },
        owner: {
          id: repo.owner_id,
          name: repo.owner_name,
          username: repo.owner_username,
          avatar_url: repo.owner_avatar_url,
        },
        release: {
          id: latestPackage.release.id,
          tag: latestPackage.release.tag,
          published_at: latestPackage.release.publishedAt,
        },
        asset: {
          id: latestPackage.asset.id,
          name: latestPackage.asset.name,
          size: latestPackage.asset.size,
          download_count: latestPackage.asset.download_count,
        },
        published_at: latestPackage.release.publishedAt,
        rating_avg: rating.rating_avg,
        rating_count: rating.rating_count,
      },
    });
  })
  .get('/packages/:username/:repoName/versions', async (c) => {
    const username = c.req.param('username');
    const repoName = c.req.param('repoName');
    const db = getDb(c.env.DB);

    const repo = await findRepoByUsernameAndName(db, username, repoName);

    if (!repo || repo.visibility !== 'public') {
      return notFound(c, 'Repository');
    }

    const releaseRows = await db.select().from(repoReleases).where(
      and(eq(repoReleases.repoId, repo.id), eq(repoReleases.isDraft, false))
    ).orderBy(desc(repoReleases.publishedAt)).all();

    const releaseIds = releaseRows.map(r => r.id);
    const allAssets = releaseIds.length > 0
      ? await db.select().from(repoReleaseAssets).where(inArray(repoReleaseAssets.releaseId, releaseIds)).orderBy(asc(repoReleaseAssets.createdAt)).all()
      : [];
    const assetsByRelease = new Map<string, typeof allAssets>();
    for (const asset of allAssets) {
      const list = assetsByRelease.get(asset.releaseId) ?? [];
      list.push(asset);
      assetsByRelease.set(asset.releaseId, list);
    }
    const releases = releaseRows.map(r => ({
      ...r,
      repoReleaseAssets: assetsByRelease.get(r.id) ?? [],
    }));

    const versions = releases
      .map(release => {
        const assets = toReleaseAssets(release.repoReleaseAssets);
        const takopackAsset = assets.find((a) => a.bundle_format === 'takopack');
        if (!takopackAsset) return null;

        return {
          tag: release.tag,
          app_id: takopackAsset.bundle_meta?.app_id || takopackAsset.bundle_meta?.name || repo.name,
          version: takopackAsset.bundle_meta?.version || release.tag,
          is_prerelease: release.isPrerelease,
          asset_id: takopackAsset.id,
          size: takopackAsset.size,
          download_count: takopackAsset.download_count,
          published_at: release.publishedAt,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    return c.json({ versions });
  })
  // Takopack Reviews API
  .get('/packages/by-repo/:repoId/reviews', withCache({
    ttl: CacheTTL.PUBLIC_CONTENT,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['limit', 'offset'],
  }), async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const limit = parseLimit(c.req.query('limit'), 20, 50);
    const offset = parseOffset(c.req.query('offset'));
    const db = getDb(c.env.DB);

    const repo = await db.select({ id: repositories.id, name: repositories.name }).from(repositories).where(
      and(eq(repositories.id, repoId), eq(repositories.visibility, 'public'))
    ).get();
    if (!repo) {
      return notFound(c, 'Repository');
    }

    const rating = await getTakopackRatingSummary(db, repoId);

    return c.json({
      repo: { id: repo.id, name: repo.name },
      rating,
      reviews: [],
      viewer_review: null,
      has_more: false,
    });
  })
  .post('/packages/by-repo/:repoId/reviews', async (c) => {
    return errorResponse(c, 410, 'Bundle reviews are no longer supported');
  })
  // User/Workspace Discovery API
  .get('/users', withCache({
    ttl: CacheTTL.PUBLIC_LISTING,
    cacheTag: CacheTags.EXPLORE,
    queryParamsToInclude: ['q', 'limit', 'offset'],
  }), async (c) => {
    const { ne } = await import('drizzle-orm');
    const db = getDb(c.env.DB);
    const searchQuery = c.req.query('q')?.trim() || '';
    const limit = parseLimit(c.req.query('limit'), 20, 100);
    const offset = parseOffset(c.req.query('offset'));

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

    // Sequential to avoid D1 concurrency issues
    const usersWithRepoCount = [];
    for (const user of users.slice(0, limit).filter(u => u.slug)) {
      const cntResult = await db.select({ count: count() }).from(repositories).where(
        and(eq(repositories.visibility, 'public'), eq(repositories.accountId, user.id))
      ).get();
      const cnt = cntResult?.count ?? 0;
      if (cnt > 0) {
        usersWithRepoCount.push({
          username: user.slug as string,
          name: user.name,
          avatar_url: user.picture,
          public_repo_count: cnt,
        });
      }
    }

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
      return notFound(c, 'User');
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
