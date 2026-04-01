// ---------------------------------------------------------------------------
// explore-packages.ts — main entry point that composes search, filter, stats
// ---------------------------------------------------------------------------

import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb } from '../../../infra/db/index.ts';
import type {
  PackageWithTakopack,
  PackageDto,
  SearchPackagesParams,
  SearchPackagesResult,
  SuggestPackageDto,
  SuggestPackagesParams,
  TakopackRatingStats,
} from './explore-package-types.ts';
import { queryReleasesWithRepo, loadAssetsForReleases, buildPackagesFromRows } from './explore-search.ts';
import { SORT_ALIASES, filterPackages, sortPackages } from './explore-package-filters.ts';
import { getTakopackRatingStats, type getTakopackRatingSummary as _getTakopackRatingSummary, fetchPublishStatuses } from './explore-stats.ts';
import { textDateNullable } from '../../../shared/utils/db-guards.ts';

// ---------------------------------------------------------------------------
// Re-export types and functions so existing importers continue to work
// ---------------------------------------------------------------------------

export type {
  PackageDto,
  SearchPackagesParams,
  SearchPackagesResult,
  SuggestPackageDto,
  SuggestPackagesParams,
  TakopackRatingStats,
} from './explore-package-types.ts';

export { getTakopackRatingStats, getTakopackRatingSummary } from './explore-stats.ts';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolvePackageOwner(account: PackageWithTakopack['release']['repository']['account']) {
  return {
    id: account.id,
    name: account.name,
    username: account.slug,
    avatar_url: account.picture || null,
  };
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
      published_at: textDateNullable(pkg.release.publishedAt),
    },
    asset: {
      id: pkg.primaryAsset.id,
      name: pkg.primaryAsset.name,
      size: pkg.primaryAsset.size,
      download_count: pkg.primaryAsset.download_count,
    },
    total_downloads: pkg.totalDownloads,
    published_at: textDateNullable(pkg.release.publishedAt),
    rating_avg: ratingStatsByRepoId.get(pkg.release.repository.id)?.rating_avg ?? null,
    rating_count: ratingStatsByRepoId.get(pkg.release.repository.id)?.rating_count ?? 0,
    publish_status: publishStatus,
    certified: publishStatus === 'approved',
  };
}

// ---------------------------------------------------------------------------
// Package search (main orchestrator)
// ---------------------------------------------------------------------------

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
          published_at: textDateNullable(release.publishedAt),
        },
        asset: {
          id: primaryAsset.id,
          name: primaryAsset.name,
          size: primaryAsset.size,
          download_count: primaryAsset.download_count,
        },
        total_downloads: totalDownloads,
        published_at: textDateNullable(release.publishedAt),
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
