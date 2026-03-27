import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, repoReleases, repoReleaseAssets, repositories, accounts } from '../../../infra/db';
import { eq, and, desc, asc, like, sql } from 'drizzle-orm';
import { toIsoString } from '../../../shared/utils';
import { toReleaseAssets } from './repo-release-assets';
import type { Database } from '../../../infra/db';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface ReleaseAsset {
  id: string;
  name: string;
  content_type: string;
  size: number;
  r2_key: string;
  download_count: number;
  bundle_format?: string;
  bundle_meta?: {
    name?: string;
    app_id?: string;
    version: string;
    description?: string;
    icon?: string;
    category?: 'app' | 'service' | 'library' | 'template' | 'social';
    tags?: string[];
    dependencies?: Array<{ repo: string; version: string }>;
  };
  created_at: string;
}

type TakopackRatingStats = {
  rating_avg: number | null;
  rating_count: number;
};

// ---------------------------------------------------------------------------
// Rating helpers (shared with route file)
// ---------------------------------------------------------------------------

export async function getTakopackRatingStats(
  _db: Database,
  repoIds: string[],
): Promise<Map<string, TakopackRatingStats>> {
  const map = new Map<string, TakopackRatingStats>();
  for (const repoId of repoIds) {
    map.set(repoId, {
      rating_avg: null,
      rating_count: 0,
    });
  }

  return map;
}

export async function getTakopackRatingSummary(
  _db: Database,
  _repoId: string,
): Promise<TakopackRatingStats> {
  return {
    rating_avg: null,
    rating_count: 0,
  };
}

// ---------------------------------------------------------------------------
// Package search
// ---------------------------------------------------------------------------

export interface SearchPackagesParams {
  searchQuery: string;
  sortParamRaw: string;
  limit: number;
  offset: number;
  category: string | undefined;
  tags: string[];
  certifiedOnly: boolean;
}

export interface PackageDto {
  id: string;
  name: string;
  app_id: string;
  version: string;
  description: string | null;
  icon: string | undefined;
  category: string | undefined;
  tags: string[] | undefined;
  repository: {
    id: string;
    name: string;
    description: string | null;
    stars: number;
  };
  owner: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
  } | null;
  release: {
    id: string;
    tag: string;
    published_at: string | null;
  };
  asset: {
    id: string;
    name: string;
    size: number;
    download_count: number;
  };
  total_downloads: number;
  published_at: string | null;
  rating_avg: number | null;
  rating_count: number;
  publish_status: string;
  certified: boolean;
}

export interface SearchPackagesResult {
  packages: PackageDto[];
  has_more: boolean;
}

/** Internal type for a release with its takopack assets. */
interface PackageWithTakopack {
  release: {
    id: string;
    publishedAt: string | Date | null;
    description: string | null;
    tag: string;
    repository: {
      id: string;
      name: string;
      description: string | null;
      stars: number;
      account: {
        id: string;
        slug: string;
        name: string;
        picture: string | null;
      };
    };
  };
  primaryAsset: ReleaseAsset;
  totalDownloads: number;
}

function resolvePackageOwner(account: PackageWithTakopack['release']['repository']['account']) {
  return {
    id: account.id,
    name: account.name,
    username: account.slug,
    avatar_url: account.picture || null,
  };
}

const SORT_ALIASES: Record<string, string> = { popular: 'downloads', new: 'created' };

// ---------------------------------------------------------------------------
// Query helpers — joined Drizzle queries for package exploration
// ---------------------------------------------------------------------------

interface ReleaseRow {
  id: string;
  tag: string;
  description: string | null;
  publishedAt: string | null;
  repoId: string;
  repoName: string;
  repoDescription: string | null;
  repoStars: number;
  accountId: string;
  accountSlug: string;
  accountName: string;
  accountPicture: string | null;
}

async function queryReleasesWithRepo(
  db: Database,
  opts: {
    searchQuery?: string;
    orderByColumn: 'updatedAt' | 'createdAt' | 'downloads';
    limit: number;
    offset: number;
  },
): Promise<ReleaseRow[]> {
  const { searchQuery, orderByColumn, limit, offset } = opts;

  const orderMap = {
    updatedAt: desc(repoReleases.updatedAt),
    createdAt: desc(repoReleases.createdAt),
    downloads: desc(repoReleases.downloads),
  } as const;

  const conditions = [
    eq(repoReleases.isDraft, false),
    eq(repoReleases.isPrerelease, false),
    eq(repositories.visibility, 'public'),
  ];

  if (searchQuery) {
    conditions.push(
      sql`(${like(repositories.name, `%${searchQuery}%`)} OR ${like(repositories.description, `%${searchQuery}%`)})`,
    );
  }

  const rows = await db
    .select({
      id: repoReleases.id,
      tag: repoReleases.tag,
      description: repoReleases.description,
      publishedAt: repoReleases.publishedAt,
      repoId: repositories.id,
      repoName: repositories.name,
      repoDescription: repositories.description,
      repoStars: repositories.stars,
      accountId: accounts.id,
      accountSlug: accounts.slug,
      accountName: accounts.name,
      accountPicture: accounts.picture,
    })
    .from(repoReleases)
    .innerJoin(repositories, eq(repoReleases.repoId, repositories.id))
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(...conditions))
    .orderBy(orderMap[orderByColumn])
    .limit(limit)
    .offset(offset)
    .all();

  return rows;
}

async function loadAssetsForReleases(
  db: Database,
  releaseIds: string[],
): Promise<Map<string, ReturnType<typeof toReleaseAssets>>> {
  if (releaseIds.length === 0) return new Map();

  const assetRows = await db
    .select()
    .from(repoReleaseAssets)
    .where(sql`${repoReleaseAssets.releaseId} IN (${sql.join(releaseIds.map(id => sql`${id}`), sql`, `)})`)
    .orderBy(asc(repoReleaseAssets.createdAt))
    .all();

  const grouped = new Map<string, typeof assetRows>();
  for (const row of assetRows) {
    const arr = grouped.get(row.releaseId) ?? [];
    arr.push(row);
    grouped.set(row.releaseId, arr);
  }

  const result = new Map<string, ReturnType<typeof toReleaseAssets>>();
  for (const [releaseId, rows] of grouped) {
    result.set(releaseId, toReleaseAssets(rows));
  }
  return result;
}

function buildPackagesFromRows(
  releaseRows: ReleaseRow[],
  assetsByRelease: Map<string, ReturnType<typeof toReleaseAssets>>,
): PackageWithTakopack[] {
  return releaseRows
    .map((row) => {
      const assets = assetsByRelease.get(row.id) ?? [];
      const takopackAssets = assets.filter((a) => a.bundle_format === 'takopack');
      if (takopackAssets.length === 0) return null;

      return {
        release: {
          id: row.id,
          publishedAt: row.publishedAt,
          description: row.description,
          tag: row.tag,
          repository: {
            id: row.repoId,
            name: row.repoName,
            description: row.repoDescription,
            stars: row.repoStars,
            account: {
              id: row.accountId,
              slug: row.accountSlug,
              name: row.accountName,
              picture: row.accountPicture,
            },
          },
        },
        primaryAsset: takopackAssets[0],
        totalDownloads: takopackAssets.reduce((sum, a) => sum + (a.download_count || 0), 0),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}

/**
 * Search, filter, sort, and paginate takopack packages.
 */
export async function searchPackages(
  d1: D1Database,
  params: SearchPackagesParams,
): Promise<SearchPackagesResult> {
  const db = getDb(d1);
  const { searchQuery, limit, offset, category, tags, certifiedOnly } = params;
  const sortParam = SORT_ALIASES[params.sortParamRaw] || params.sortParamRaw;

  const ORDER_BY_MAP: Record<string, 'updatedAt' | 'createdAt' | 'downloads'> = {
    updated: 'updatedAt',
    created: 'createdAt',
  };
  const orderByColumn = ORDER_BY_MAP[sortParam] || 'downloads';

  const releaseRows = await queryReleasesWithRepo(db, {
    searchQuery: searchQuery || undefined,
    orderByColumn,
    limit: limit + 1,
    offset,
  });

  const releaseIds = releaseRows.map((r) => r.id);
  const assetsByRelease = await loadAssetsForReleases(db, releaseIds);

  const packagesWithTakopack = buildPackagesFromRows(releaseRows, assetsByRelease);

  const hasMore = packagesWithTakopack.length > limit;
  if (hasMore) packagesWithTakopack.pop();

  let filtered = filterPackages(packagesWithTakopack, category, tags);

  const repoIds = Array.from(new Set(filtered.map((p) => p.release.repository.id)));
  const ratingStatsByRepoId = await getTakopackRatingStats(db, repoIds);

  sortPackages(filtered, sortParam, params.sortParamRaw, ratingStatsByRepoId);

  const publishStatusByKey = await fetchPublishStatuses(db, filtered);

  if (certifiedOnly) {
    filtered = filtered.filter(
      (p) => publishStatusByKey.get(`${p.release.id}:${p.primaryAsset.id}`) === 'approved',
    );
  }

  const hasMoreFiltered = filtered.length > limit;
  if (hasMoreFiltered) filtered.pop();

  const packages = filtered.map((pkg) =>
    toPackageDto(pkg, ratingStatsByRepoId, publishStatusByKey),
  );

  return { packages, has_more: hasMoreFiltered };
}

// ---------------------------------------------------------------------------
// Package suggest
// ---------------------------------------------------------------------------

export interface SuggestPackageDto {
  id: string;
  name: string;
  app_id: string;
  version: string;
  description: string | null;
  icon: string | undefined;
  category: string | undefined;
  tags: string[] | undefined;
  repository: {
    id: string;
    name: string;
    description: string | null;
    stars: number;
  };
  owner: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
  } | null;
  release: {
    id: string;
    tag: string;
    published_at: string | null;
  };
  asset: {
    id: string;
    name: string;
    size: number;
    download_count: number;
  };
  total_downloads: number;
  published_at: string | null;
}

export interface SuggestPackagesParams {
  query: string;
  limit: number;
  category: string | undefined;
  tags: string[];
}

export async function suggestPackages(
  d1: D1Database,
  params: SuggestPackagesParams,
): Promise<SuggestPackageDto[]> {
  const db = getDb(d1);
  const { query, limit, category, tags } = params;

  const releaseRows = await queryReleasesWithRepo(db, {
    searchQuery: query,
    orderByColumn: 'downloads',
    limit: 50,
    offset: 0,
  });

  const releaseIds = releaseRows.map((r) => r.id);
  const assetsByRelease = await loadAssetsForReleases(db, releaseIds);

  const packages = releaseRows
    .map((release) => {
      const assets = assetsByRelease.get(release.id) ?? [];
      const takopackAssets = assets.filter((a) => a.bundle_format === 'takopack');
      if (takopackAssets.length === 0) return null;
      const primaryAsset = takopackAssets[0];
      const totalDownloads = takopackAssets.reduce((sum, a) => sum + (a.download_count || 0), 0);

      return {
        id: release.id,
        name: release.repoName,
        app_id: primaryAsset.bundle_meta?.app_id || primaryAsset.bundle_meta?.name || release.repoName,
        version: primaryAsset.bundle_meta?.version || release.tag,
        description: primaryAsset.bundle_meta?.description || release.description,
        icon: primaryAsset.bundle_meta?.icon,
        category: primaryAsset.bundle_meta?.category,
        tags: primaryAsset.bundle_meta?.tags,
        repository: {
          id: release.repoId,
          name: release.repoName,
          description: release.repoDescription,
          stars: release.repoStars,
        },
        owner: resolvePackageOwner({
          id: release.accountId,
          slug: release.accountSlug,
          name: release.accountName,
          picture: release.accountPicture,
        }),
        release: {
          id: release.id,
          tag: release.tag,
          published_at: toIsoString(release.publishedAt),
        },
        asset: {
          id: primaryAsset.id,
          name: primaryAsset.name,
          size: primaryAsset.size,
          download_count: primaryAsset.download_count,
        },
        total_downloads: totalDownloads,
        published_at: toIsoString(release.publishedAt),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .filter((p) => {
      if (category && p.category !== category) return false;
      if (tags.length > 0) {
        const pkgTags = (p.tags || [])
          .map((t) => String(t || '').trim().toLowerCase())
          .filter(Boolean);
        if (pkgTags.length === 0) return false;
        if (!tags.every((t) => pkgTags.includes(t))) return false;
      }
      return true;
    })
    .slice(0, limit);

  return packages;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function filterPackages(
  packages: PackageWithTakopack[],
  category: string | undefined,
  tags: string[],
): PackageWithTakopack[] {
  let filtered = packages;

  if (category) {
    filtered = filtered.filter((p) => p.primaryAsset.bundle_meta?.category === category);
  }
  if (tags.length > 0) {
    filtered = filtered.filter((p) => {
      const pkgTags = (p.primaryAsset.bundle_meta?.tags || [])
        .map((t) => String(t || '').trim().toLowerCase())
        .filter(Boolean);
      if (pkgTags.length === 0) return false;
      return tags.every((tag) => pkgTags.includes(tag));
    });
  }

  return filtered;
}

function sortPackages(
  packages: PackageWithTakopack[],
  sortParam: string,
  sortParamRaw: string,
  ratingStatsByRepoId: Map<string, TakopackRatingStats>,
): void {
  if (sortParam === 'rating') {
    packages.sort((a, b) => {
      const ra = ratingStatsByRepoId.get(a.release.repository.id);
      const rb = ratingStatsByRepoId.get(b.release.repository.id);
      const avga = ra?.rating_avg ?? -1;
      const avgb = rb?.rating_avg ?? -1;
      if (avga !== avgb) return avgb - avga;
      const cnta = ra?.rating_count ?? 0;
      const cntb = rb?.rating_count ?? 0;
      if (cnta !== cntb) return cntb - cnta;
      if (a.totalDownloads !== b.totalDownloads) return b.totalDownloads - a.totalDownloads;
      return getPublishedMs(b) - getPublishedMs(a);
    });
  } else if (sortParamRaw === 'trending') {
    const nowMs = Date.now();
    packages.sort((a, b) => {
      const aMs = getPublishedMs(a);
      const bMs = getPublishedMs(b);
      const aAgeDays = aMs ? Math.max(0, (nowMs - aMs) / (1000 * 60 * 60 * 24)) : 3650;
      const bAgeDays = bMs ? Math.max(0, (nowMs - bMs) / (1000 * 60 * 60 * 24)) : 3650;
      const aStars = a.release.repository.stars || 0;
      const bStars = b.release.repository.stars || 0;
      const aScore = (Math.log10(a.totalDownloads + 1) + Math.log10(aStars + 1)) / (aAgeDays + 2);
      const bScore = (Math.log10(b.totalDownloads + 1) + Math.log10(bStars + 1)) / (bAgeDays + 2);
      if (aScore !== bScore) return bScore - aScore;
      if (a.totalDownloads !== b.totalDownloads) return b.totalDownloads - a.totalDownloads;
      return bMs - aMs;
    });
  } else if (sortParam === 'downloads') {
    packages.sort((a, b) => {
      if (a.totalDownloads !== b.totalDownloads) return b.totalDownloads - a.totalDownloads;
      return getPublishedMs(b) - getPublishedMs(a);
    });
  } else if (sortParam === 'created') {
    packages.sort((a, b) => {
      const pa = getPublishedMs(a);
      const pb = getPublishedMs(b);
      if (pa !== pb) return pb - pa;
      return b.totalDownloads - a.totalDownloads;
    });
  }
}

function getPublishedMs(pkg: PackageWithTakopack): number {
  return pkg.release.publishedAt ? new Date(pkg.release.publishedAt).getTime() : 0;
}

async function fetchPublishStatuses(
  _db: Database,
  _packages: PackageWithTakopack[],
): Promise<Map<string, string>> {
  return new Map<string, string>();
}

function toPackageDto(
  pkg: PackageWithTakopack,
  ratingStatsByRepoId: Map<string, TakopackRatingStats>,
  publishStatusByKey: Map<string, string>,
): PackageDto {
  const publishKey = `${pkg.release.id}:${pkg.primaryAsset.id}`;
  const publishStatus = publishStatusByKey.get(publishKey) || 'none';

  return {
    id: pkg.release.id,
    name: pkg.primaryAsset.bundle_meta?.version
      ? pkg.release.repository.name
      : pkg.primaryAsset.name.replace('.takopack', ''),
    app_id: pkg.primaryAsset.bundle_meta?.app_id || pkg.primaryAsset.bundle_meta?.name || pkg.release.repository.name,
    version: pkg.primaryAsset.bundle_meta?.version || pkg.release.tag,
    description: pkg.primaryAsset.bundle_meta?.description || pkg.release.description,
    icon: pkg.primaryAsset.bundle_meta?.icon,
    category: pkg.primaryAsset.bundle_meta?.category,
    tags: pkg.primaryAsset.bundle_meta?.tags,
    repository: {
      id: pkg.release.repository.id,
      name: pkg.release.repository.name,
      description: pkg.release.repository.description,
      stars: pkg.release.repository.stars,
    },
    owner: resolvePackageOwner(pkg.release.repository.account),
    release: {
      id: pkg.release.id,
      tag: pkg.release.tag,
      published_at: toIsoString(pkg.release.publishedAt),
    },
    asset: {
      id: pkg.primaryAsset.id,
      name: pkg.primaryAsset.name,
      size: pkg.primaryAsset.size,
      download_count: pkg.primaryAsset.download_count,
    },
    total_downloads: pkg.totalDownloads,
    published_at: toIsoString(pkg.release.publishedAt),
    rating_avg: ratingStatsByRepoId.get(pkg.release.repository.id)?.rating_avg ?? null,
    rating_count: ratingStatsByRepoId.get(pkg.release.repository.id)?.rating_count ?? 0,
    publish_status: publishStatus,
    certified: publishStatus === 'approved',
  };
}
