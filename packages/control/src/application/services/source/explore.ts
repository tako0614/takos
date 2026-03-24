import type { Env, Repository } from '../../../shared/types';
import { getDb, repositories, accounts, repoStars, repoReleases, repoReleaseAssets, bundleDeployments } from '../../../infra/db';
import { eq, and, desc, asc, gte, like, inArray, count } from 'drizzle-orm';
import { toReleaseAssets } from './repo-release-assets';

export interface ExploreRepoResponse {
  id: string;
  name: string;
  description: string | null;
  visibility: 'public';
  default_branch: string;
  stars: number;
  forks: number;
  workspace: {
    id: string;
    name: string;
  };
  owner: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
  };
  is_starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExploreReposResult {
  repos: ExploreRepoResponse[];
  total: number;
  has_more: boolean;
}

export interface CatalogRepoResponse {
  id: string;
  name: string;
  description: string | null;
  visibility: 'public';
  default_branch: string;
  stars: number;
  forks: number;
  category: string | null;
  language: string | null;
  license: string | null;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
  workspace: {
    id: string;
    name: string;
  };
  owner: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
  };
}

export interface CatalogTakopackResponse {
  available: boolean;
  app_id: string | null;
  latest_version: string | null;
  latest_tag: string | null;
  release_id: string | null;
  release_tag: string | null;
  asset_id: string | null;
  description: string | null;
  icon: string | null;
  category: string | null;
  tags: string[];
  downloads: number;
  rating_avg: number | null;
  rating_count: number;
  publish_status: 'none' | 'pending' | 'approved' | 'rejected';
  certified: boolean;
  published_at: string | null;
}

export interface CatalogInstallationResponse {
  installed: boolean;
  bundle_deployment_id: string | null;
  installed_version: string | null;
  deployed_at: string | null;
}

export interface CatalogItemResponse {
  repo: CatalogRepoResponse;
  takopack: CatalogTakopackResponse;
  installation?: CatalogInstallationResponse;
}

export interface CatalogResult {
  items: CatalogItemResponse[];
  total: number;
  has_more: boolean;
}

type CatalogSort = 'trending' | 'new' | 'stars' | 'updated' | 'downloads';
type CatalogType = 'all' | 'repo' | 'deployable-app';

type RepositoryWithAccount = {
  id: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  officialCategory: string | null;
  primaryLanguage: string | null;
  license: string | null;
  createdAt: string;
  updatedAt: string;
  account: {
    id: string;
    name: string;
    slug: string;
    picture: string | null;
  };
};

// Whitelist of allowed ORDER BY columns to prevent SQL injection
const ALLOWED_ORDER_BY_COLUMNS = {
  'updated': 'updatedAt',
  'created': 'createdAt',
  'forks': 'forks',
  'stars': 'stars',
} as const;

function resolveOrderByColumn(sort: string): keyof typeof ALLOWED_ORDER_BY_COLUMNS | 'stars' {
  return (sort in ALLOWED_ORDER_BY_COLUMNS ? sort : 'stars') as keyof typeof ALLOWED_ORDER_BY_COLUMNS;
}

function resolveOrderDirection(order: string): 'asc' | 'desc' {
  const direction = order.toLowerCase();
  return direction === 'asc' ? 'asc' : 'desc';
}

function resolveAccountOwner(account: RepositoryWithAccount['account']) {
  return {
    id: account.id,
    name: account.name,
    username: account.slug,
    avatar_url: account.picture || null,
  };
}

interface ReleaseAsset {
  id: string;
  name: string;
  size: number;
  download_count: number;
  bundle_format?: string;
  bundle_meta?: {
    name?: string;
    app_id?: string;
    version?: string;
    description?: string;
    icon?: string;
    category?: string;
    tags?: string[];
  };
}

interface ParsedTakopackRelease {
  releaseId: string;
  repoId: string;
  appId: string;
  releaseTag: string;
  publishedAt: string | null;
  version: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  tags: string[];
  assetId: string;
  downloadCount: number;
  totalDownloads: number;
}

interface ParsedCatalogTags {
  tags: string[];
  invalid: boolean;
}

function parseCatalogTags(raw: string | undefined): ParsedCatalogTags {
  if (!raw) return { tags: [], invalid: false };
  const tags = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  for (const tag of tags) {
    if (tag.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
      return { tags: [], invalid: true };
    }
  }
  return { tags, invalid: false };
}

function computeTrendingScore(options: {
  stars: number;
  downloads: number;
  updatedAtMs: number;
}): number {
  const nowMs = Date.now();
  const ageDays = Math.max(0, (nowMs - options.updatedAtMs) / (1000 * 60 * 60 * 24));
  return (Math.log10(options.downloads + 1) + Math.log10(options.stars + 1)) / (ageDays + 2);
}

async function getStarredRepoIds(
  dbBinding: Env['DB'],
  userId: string | undefined,
  repoIds: string[]
) {
  if (!userId || repoIds.length === 0) {
    return new Set<string>();
  }

  const db = getDb(dbBinding);

  const stars = await db.select({ repoId: repoStars.repoId }).from(repoStars)
    .where(and(
      eq(repoStars.accountId, userId),
      inArray(repoStars.repoId, repoIds),
    ))
    .all();

  return new Set(stars.map(s => s.repoId));
}

function mapExploreRepos(
  repos: RepositoryWithAccount[],
  starredIds: Set<string>
): ExploreRepoResponse[] {
  return repos.map((repo) => {
    const owner = resolveAccountOwner(repo.account);
    return ({
    id: repo.id,
    name: repo.name,
    description: repo.description,
    visibility: 'public',
    default_branch: repo.defaultBranch,
    stars: repo.stars,
    forks: repo.forks,
    workspace: {
      id: repo.account.id,
      name: repo.account.name,
    },
    owner,
    is_starred: starredIds.has(repo.id),
    created_at: repo.createdAt || '',
    updated_at: repo.updatedAt || '',
  })});
}

async function buildExploreResult(
  dbBinding: Env['DB'],
  repos: RepositoryWithAccount[],
  total: number,
  offset: number,
  userId?: string
): Promise<ExploreReposResult> {
  const starredIds = await getStarredRepoIds(
    dbBinding,
    userId,
    repos.map(repo => repo.id)
  );
  const mappedRepos = mapExploreRepos(repos, starredIds);

  return {
    repos: mappedRepos,
    total,
    has_more: offset + mappedRepos.length < total,
  };
}

// Helper to query repos with joined account info
async function queryReposWithAccount(
  dbBinding: Env['DB'],
  options: {
    conditions: any[];
    orderBy: any[];
    limit?: number;
    offset?: number;
  }
): Promise<RepositoryWithAccount[]> {
  const db = getDb(dbBinding);
  const rows = await db.select({
    id: repositories.id,
    name: repositories.name,
    description: repositories.description,
    defaultBranch: repositories.defaultBranch,
    stars: repositories.stars,
    forks: repositories.forks,
    officialCategory: repositories.officialCategory,
    primaryLanguage: repositories.primaryLanguage,
    license: repositories.license,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
    accountId: accounts.id,
    accountName: accounts.name,
    accountSlug: accounts.slug,
    accountPicture: accounts.picture,
  })
    .from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(...options.conditions))
    .orderBy(...options.orderBy)
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0)
    .all();

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    defaultBranch: r.defaultBranch,
    stars: r.stars,
    forks: r.forks,
    officialCategory: r.officialCategory,
    primaryLanguage: r.primaryLanguage,
    license: r.license,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    account: {
      id: r.accountId,
      name: r.accountName,
      slug: r.accountSlug,
      picture: r.accountPicture,
    },
  }));
}

async function countRepos(
  dbBinding: Env['DB'],
  conditions: any[]
): Promise<number> {
  const db = getDb(dbBinding);
  const result = await db.select({ count: count() })
    .from(repositories)
    .where(and(...conditions))
    .get();
  return result?.count ?? 0;
}

function buildBaseConditions(options: {
  category?: string;
  language?: string;
  license?: string;
  since?: string;
  sinceField?: 'createdAt' | 'updatedAt';
  searchQuery?: string;
}): any[] {
  const conditions: any[] = [eq(repositories.visibility, 'public')];
  if (options.category) conditions.push(eq(repositories.officialCategory, options.category));
  if (options.language) conditions.push(eq(repositories.primaryLanguage, options.language));
  if (options.license) conditions.push(eq(repositories.license, options.license));
  if (options.since) {
    const field = options.sinceField === 'createdAt' ? repositories.createdAt : repositories.updatedAt;
    conditions.push(gte(field, options.since));
  }
  if (options.searchQuery) {
    // Note: Drizzle doesn't support OR easily at top level in conditions array,
    // so we use like on name as primary search
    conditions.push(like(repositories.name, `%${options.searchQuery}%`));
  }
  return conditions;
}

export async function listExploreRepos(
  dbBinding: Env['DB'],
  options: {
    sort: string;
    order: string;
    limit: number;
    offset: number;
    searchQuery: string;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
  }
): Promise<ExploreReposResult> {
  const sortKey = resolveOrderByColumn(options.sort);
  const orderDirection = resolveOrderDirection(options.order);

  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: options.since,
    sinceField: 'updatedAt',
    searchQuery: options.searchQuery || undefined,
  });

  const orderByMap = {
    'updatedAt': repositories.updatedAt,
    'createdAt': repositories.createdAt,
    'forks': repositories.forks,
    'stars': repositories.stars,
  } as const;
  const col = orderByMap[ALLOWED_ORDER_BY_COLUMNS[sortKey as keyof typeof ALLOWED_ORDER_BY_COLUMNS] as keyof typeof orderByMap] ?? repositories.stars;
  const orderByClause = orderDirection === 'asc' ? asc(col) : desc(col);

  const [repos, total] = await Promise.all([
    queryReposWithAccount(dbBinding, {
      conditions,
      orderBy: [orderByClause],
      limit: options.limit,
      offset: options.offset,
    }),
    countRepos(dbBinding, conditions),
  ]);

  return buildExploreResult(
    dbBinding,
    repos,
    total,
    options.offset,
    options.userId
  );
}

export async function listTrendingRepos(
  dbBinding: Env['DB'],
  options: {
    limit: number;
    offset: number;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
  }
): Promise<ExploreReposResult> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString();
  const updatedSince = options.since && options.since > sevenDaysAgoStr ? options.since : sevenDaysAgoStr;

  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: updatedSince,
    sinceField: 'updatedAt',
  });

  const repos = await queryReposWithAccount(dbBinding, {
    conditions,
    orderBy: [desc(repositories.stars), desc(repositories.updatedAt)],
    limit: options.limit,
    offset: options.offset,
  });

  const total = await countRepos(dbBinding, conditions);

  return buildExploreResult(
    dbBinding,
    repos,
    total,
    options.offset,
    options.userId
  );
}

export async function listNewRepos(
  dbBinding: Env['DB'],
  options: {
    limit: number;
    offset: number;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
  }
): Promise<ExploreReposResult> {
  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: options.since,
    sinceField: 'createdAt',
  });

  const [repos, total] = await Promise.all([
    queryReposWithAccount(dbBinding, {
      conditions,
      orderBy: [desc(repositories.createdAt)],
      limit: options.limit,
      offset: options.offset,
    }),
    countRepos(dbBinding, conditions),
  ]);

  return buildExploreResult(
    dbBinding,
    repos,
    total,
    options.offset,
    options.userId
  );
}

export async function listRecentRepos(
  dbBinding: Env['DB'],
  options: {
    limit: number;
    offset: number;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
  }
): Promise<ExploreReposResult> {
  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: options.since,
    sinceField: 'updatedAt',
  });

  const [repos, total] = await Promise.all([
    queryReposWithAccount(dbBinding, {
      conditions,
      orderBy: [desc(repositories.updatedAt)],
      limit: options.limit,
      offset: options.offset,
    }),
    countRepos(dbBinding, conditions),
  ]);

  return buildExploreResult(
    dbBinding,
    repos,
    total,
    options.offset,
    options.userId
  );
}

export async function listCatalogItems(
  dbBinding: Env['DB'],
  options: {
    sort: CatalogSort;
    limit: number;
    offset: number;
    searchQuery?: string;
    type?: CatalogType;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    tagsRaw?: string;
    certifiedOnly?: boolean;
    spaceId?: string;
    userId?: string;
  }
): Promise<CatalogResult> {
  const db = getDb(dbBinding);

  const parsedTags = parseCatalogTags(options.tagsRaw);
  if (parsedTags.invalid) {
    return { items: [], total: 0, has_more: false };
  }

  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: options.since,
    sinceField: 'updatedAt',
    searchQuery: options.searchQuery?.trim() || undefined,
  });

  const repos = await queryReposWithAccount(dbBinding, {
    conditions,
    orderBy: [desc(repositories.stars)],
  });

  if (repos.length === 0) {
    return { items: [], total: 0, has_more: false };
  }

  const repoIds = repos.map((repo) => repo.id);
  const starredRepoIds = await getStarredRepoIds(dbBinding, options.userId, repoIds);

  const releases = await db.select({
    id: repoReleases.id,
    repoId: repoReleases.repoId,
    tag: repoReleases.tag,
    description: repoReleases.description,
    publishedAt: repoReleases.publishedAt,
    repoName: repositories.name,
  })
    .from(repoReleases)
    .innerJoin(repositories, eq(repoReleases.repoId, repositories.id))
    .where(and(
      inArray(repoReleases.repoId, repoIds),
      eq(repoReleases.isDraft, false),
      eq(repoReleases.isPrerelease, false),
    ))
    .orderBy(desc(repoReleases.publishedAt), desc(repoReleases.createdAt))
    .all();

  // Fetch assets for these releases
  const releaseIds = releases.map(r => r.id);
  const allAssets = releaseIds.length > 0
    ? await db.select().from(repoReleaseAssets)
        .where(inArray(repoReleaseAssets.releaseId, releaseIds))
        .orderBy(asc(repoReleaseAssets.createdAt))
        .all()
    : [];

  const assetsByRelease = new Map<string, typeof allAssets>();
  for (const asset of allAssets) {
    const list = assetsByRelease.get(asset.releaseId) || [];
    list.push(asset);
    assetsByRelease.set(asset.releaseId, list);
  }

  const latestTakopackByRepoId = new Map<string, ParsedTakopackRelease>();
  for (const release of releases) {
    if (latestTakopackByRepoId.has(release.repoId)) continue;
    const releaseAssetRows = assetsByRelease.get(release.id) || [];
    const assets = toReleaseAssets(releaseAssetRows);
    const takopackAssets = assets.filter((asset) => asset.bundle_format === 'takopack');
    if (takopackAssets.length === 0) continue;

    const primaryAsset = takopackAssets[0];
    const totalDownloads = takopackAssets.reduce(
      (sum, asset) => sum + (asset.download_count || 0),
      0,
    );
    latestTakopackByRepoId.set(release.repoId, {
      releaseId: release.id,
      repoId: release.repoId,
      appId: primaryAsset.bundle_meta?.app_id || primaryAsset.bundle_meta?.name || release.repoName,
      releaseTag: release.tag,
      publishedAt: release.publishedAt ?? null,
      version: primaryAsset.bundle_meta?.version || release.tag,
      description: primaryAsset.bundle_meta?.description || release.description || null,
      icon: primaryAsset.bundle_meta?.icon || null,
      category: primaryAsset.bundle_meta?.category || null,
      tags: Array.isArray(primaryAsset.bundle_meta?.tags)
        ? primaryAsset.bundle_meta?.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
      assetId: primaryAsset.id,
      downloadCount: primaryAsset.download_count || 0,
      totalDownloads,
    });
  }

  const reviewMap = new Map<string, { ratingAvg: number | null; ratingCount: number }>();

  const publishStatusMap = new Map<string, 'none' | 'pending' | 'approved' | 'rejected'>();

  const installationMap = new Map<string, {
    id: string;
    version: string;
    deployedAt: string;
  }>();
  if (options.spaceId) {
    const installs = await db.select({
      id: bundleDeployments.id,
      version: bundleDeployments.version,
      sourceRepoId: bundleDeployments.sourceRepoId,
      deployedAt: bundleDeployments.deployedAt,
    }).from(bundleDeployments)
      .where(and(
        eq(bundleDeployments.accountId, options.spaceId),
        eq(bundleDeployments.sourceType, 'git'),
        inArray(bundleDeployments.sourceRepoId, repoIds),
      ))
      .orderBy(desc(bundleDeployments.deployedAt))
      .all();
    for (const install of installs) {
      if (!install.sourceRepoId) continue;
      if (!installationMap.has(install.sourceRepoId)) {
        installationMap.set(install.sourceRepoId, {
          id: install.id,
          version: install.version,
          deployedAt: install.deployedAt || '',
        });
      }
    }
  }

  let items: CatalogItemResponse[] = repos.map((repo) => {
    const takopackRelease = latestTakopackByRepoId.get(repo.id);
    const review = reviewMap.get(repo.id);
    const publishStatus = takopackRelease
      ? (publishStatusMap.get(`${takopackRelease.releaseId}:${takopackRelease.assetId}`) || 'none')
      : 'none';
    const installation = options.spaceId
      ? installationMap.get(repo.id)
      : undefined;

    const item: CatalogItemResponse = {
      repo: {
        id: repo.id,
        name: repo.name,
        description: repo.description,
        visibility: 'public',
        default_branch: repo.defaultBranch,
        stars: repo.stars,
        forks: repo.forks,
        category: repo.officialCategory || null,
        language: repo.primaryLanguage || null,
        license: repo.license || null,
        is_starred: starredRepoIds.has(repo.id),
        created_at: repo.createdAt || '',
        updated_at: repo.updatedAt || '',
        workspace: {
          id: repo.account.id,
          name: repo.account.name,
        },
        owner: resolveAccountOwner(repo.account),
      },
      takopack: {
        available: !!takopackRelease,
        app_id: takopackRelease?.appId || null,
        latest_version: takopackRelease?.version || null,
        latest_tag: takopackRelease?.releaseTag || null,
        release_id: takopackRelease?.releaseId || null,
        release_tag: takopackRelease?.releaseTag || null,
        asset_id: takopackRelease?.assetId || null,
        description: takopackRelease?.description || null,
        icon: takopackRelease?.icon || null,
        category: takopackRelease?.category || null,
        tags: takopackRelease?.tags || [],
        downloads: takopackRelease?.totalDownloads || 0,
        rating_avg: review?.ratingAvg ?? null,
        rating_count: review?.ratingCount ?? 0,
        publish_status: publishStatus,
        certified: publishStatus === 'approved',
        published_at: takopackRelease?.publishedAt || null,
      },
    };

    if (options.spaceId) {
      item.installation = {
        installed: !!installation,
        bundle_deployment_id: installation?.id || null,
        installed_version: installation?.version || null,
        deployed_at: installation?.deployedAt || null,
      };
    }

    return item;
  });

  if (options.type === 'deployable-app') {
    items = items.filter((item) => item.takopack.available);
  }

  if (parsedTags.tags.length > 0) {
    items = items.filter((item) => {
      if (!item.takopack.available) return false;
      const packageTags = item.takopack.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
      return parsedTags.tags.every((tag) => packageTags.includes(tag));
    });
  }

  if (options.certifiedOnly) {
    items = items.filter((item) => item.takopack.certified);
  }

  const sort = options.sort;
  items.sort((left, right) => {
    if (sort === 'downloads') {
      const byDownloads = right.takopack.downloads - left.takopack.downloads;
      if (byDownloads !== 0) return byDownloads;
      return right.repo.stars - left.repo.stars;
    }

    if (sort === 'new') {
      const leftMs = Date.parse(left.takopack.published_at || left.repo.created_at) || 0;
      const rightMs = Date.parse(right.takopack.published_at || right.repo.created_at) || 0;
      if (rightMs !== leftMs) return rightMs - leftMs;
      return right.repo.stars - left.repo.stars;
    }

    if (sort === 'updated') {
      const leftMs = Date.parse(left.repo.updated_at) || 0;
      const rightMs = Date.parse(right.repo.updated_at) || 0;
      if (rightMs !== leftMs) return rightMs - leftMs;
      return right.repo.stars - left.repo.stars;
    }

    if (sort === 'trending') {
      const leftScore = computeTrendingScore({
        stars: left.repo.stars,
        downloads: left.takopack.downloads,
        updatedAtMs: Date.parse(left.repo.updated_at) || 0,
      });
      const rightScore = computeTrendingScore({
        stars: right.repo.stars,
        downloads: right.takopack.downloads,
        updatedAtMs: Date.parse(right.repo.updated_at) || 0,
      });
      if (rightScore !== leftScore) return rightScore - leftScore;
      return right.repo.stars - left.repo.stars;
    }

    const byStars = right.repo.stars - left.repo.stars;
    if (byStars !== 0) return byStars;
    const leftUpdated = Date.parse(left.repo.updated_at) || 0;
    const rightUpdated = Date.parse(right.repo.updated_at) || 0;
    return rightUpdated - leftUpdated;
  });

  const total = items.length;
  const pagedItems = items.slice(options.offset, options.offset + options.limit);

  return {
    items: pagedItems,
    total,
    has_more: options.offset + pagedItems.length < total,
  };
}
