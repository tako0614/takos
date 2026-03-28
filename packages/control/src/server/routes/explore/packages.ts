import { Hono } from 'hono';
import type { Env, User } from '../../../shared/types';
import {
  listCatalogItems,
} from '../../../application/services/source/explore';
import {
  searchPackages,
  suggestPackages,
  getTakopackRatingSummary,
} from '../../../application/services/source/explore-packages';
import { withCache, CacheTTL, CacheTags } from '../../middleware/cache';
import { checkSpaceAccess } from '../../../shared/utils';
import { getDb } from '../../../infra/db';
import { repositories, repoReleases, repoReleaseAssets } from '../../../infra/db/schema';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { toReleaseAssets } from '../../../application/services/source/repo-release-assets';
import { parseLimit, parseOffset } from '../shared/route-auth';
import { BadRequestError, AuthenticationError, AuthorizationError, NotFoundError, GoneError } from '@takos/common/errors';
import {
  buildCatalogSuggestions,
  EXPLORE_CATEGORIES,
  findRepoByUsernameAndName,
  normalizeSimpleFilter,
  parseExploreFilters,
  validateExploreFilters,
  type ReleaseAsset,
} from './explore-filters';

type Variables = {
  user?: User;
};

export default new Hono<{ Bindings: Env; Variables: Variables }>()
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
    validateExploreFilters(c, filters);

    const sortRaw = (c.req.query('sort') || 'trending').trim().toLowerCase();
    const sort = (
      sortRaw === 'trending' ||
      sortRaw === 'new' ||
      sortRaw === 'stars' ||
      sortRaw === 'updated' ||
      sortRaw === 'downloads'
    ) ? sortRaw : null;
    if (!sort) {
      throw new BadRequestError('Invalid sort');
    }

    const typeRaw = (c.req.query('type') || 'all').trim().toLowerCase();
    const normalizedCatalogType = typeRaw === 'deployable-app' ? 'deployable-app' : typeRaw;
    const catalogType = (
      normalizedCatalogType === 'all'
      || normalizedCatalogType === 'repo'
      || normalizedCatalogType === 'deployable-app'
      || normalizedCatalogType === 'official'
    )
      ? normalizedCatalogType
      : null;
    if (!catalogType) {
      throw new BadRequestError('Invalid type');
    }

    const spaceIdRaw = c.req.query('space_id')?.trim();
    let resolvedSpaceId: string | undefined;
    if (spaceIdRaw) {
      if (!user) {
        throw new AuthenticationError('Authentication required for space_id');
      }
      const access = await checkSpaceAccess(c.env.DB, spaceIdRaw, user.id);
      if (!access) {
        throw new AuthorizationError('Workspace access denied');
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
        throw new BadRequestError('Invalid tags (expected comma-separated tag slugs)');
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
      throw new BadRequestError('Invalid category');
    }

    const tags = (tagsRaw || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
    for (const t of tags) {
      if (t.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(t)) {
        throw new BadRequestError('Invalid tags (expected comma-separated tag slugs)');
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
      throw new BadRequestError('Invalid category');
    }

    const tags = (tagsRaw || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
    for (const t of tags) {
      if (t.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(t)) {
        throw new BadRequestError('Invalid tags (expected comma-separated tag slugs)');
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
      throw new NotFoundError('Repository');
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
      throw new NotFoundError('Takopack release');
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
      throw new NotFoundError('Repository');
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
      throw new NotFoundError('Repository');
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
    throw new GoneError('Bundle reviews are no longer supported');
  });
