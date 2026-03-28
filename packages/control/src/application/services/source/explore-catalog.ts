import type { Env } from '../../../shared/types';
import { getDb, repositories, repoReleases, repoReleaseAssets, bundleDeployments } from '../../../infra/db';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { toReleaseAssets } from './repo-release-assets';
import type {
  CatalogSort,
  CatalogType,
  CatalogItemResponse,
  CatalogResult,
  ParsedTakopackRelease,
} from './explore-types';
import {
  buildBaseConditions,
  queryReposWithAccount,
  getStarredRepoIds,
  resolveAccountOwner,
  parseCatalogTags,
  computeTrendingScore,
} from './source-exploration';
import { OFFICIAL_PACKAGES, type OfficialPackage } from './official-packages';

function officialPackageToCatalogItem(pkg: OfficialPackage): CatalogItemResponse {
  return {
    repo: {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      visibility: 'public',
      default_branch: 'main',
      stars: 0,
      forks: 0,
      category: pkg.category,
      language: 'TypeScript',
      license: null,
      is_starred: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      workspace: { id: 'official', name: 'Takos' },
      owner: {
        id: 'official',
        name: pkg.owner.name,
        username: pkg.owner.username,
        avatar_url: null,
      },
    },
    takopack: {
      available: true,
      app_id: pkg.id,
      latest_version: null,
      latest_tag: null,
      release_id: null,
      release_tag: null,
      asset_id: null,
      description: pkg.description,
      icon: null,
      category: pkg.category,
      tags: pkg.tags,
      downloads: 0,
      rating_avg: null,
      rating_count: 0,
      publish_status: 'approved',
      certified: true,
      published_at: null,
    },
    official: true,
  };
}

function filterOfficialPackages(options: {
  searchQuery?: string;
  category?: string;
  type?: CatalogType;
  tagsRaw?: string;
  certifiedOnly?: boolean;
}): CatalogItemResponse[] {
  let packages = OFFICIAL_PACKAGES;

  // Category filter
  if (options.category) {
    packages = packages.filter((pkg) => pkg.category === options.category);
  }

  // Search query filter
  if (options.searchQuery) {
    const query = options.searchQuery.trim().toLowerCase();
    if (query) {
      packages = packages.filter((pkg) =>
        pkg.name.toLowerCase().includes(query) ||
        pkg.description.toLowerCase().includes(query) ||
        pkg.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }
  }

  const items = packages
    .sort((a, b) => b.priority - a.priority)
    .map(officialPackageToCatalogItem);

  // Tag filter
  const parsedTags = parseCatalogTags(options.tagsRaw);
  if (!parsedTags.invalid && parsedTags.tags.length > 0) {
    return items.filter((item) => {
      const packageTags = item.takopack.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
      return parsedTags.tags.every((tag) => packageTags.includes(tag));
    });
  }

  // type=repo means non-deployable, official packages are always deployable
  // type=deployable-app keeps them, type=all keeps them
  if (options.type === 'repo') {
    return [];
  }

  return items;
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

  // Official-only: return only hardcoded official packages
  if (options.type === 'official') {
    const officialItems = filterOfficialPackages({
      searchQuery: options.searchQuery,
      category: options.category,
      type: options.type,
      tagsRaw: options.tagsRaw,
      certifiedOnly: options.certifiedOnly,
    });
    const pagedItems = officialItems.slice(options.offset, options.offset + options.limit);
    return {
      items: pagedItems,
      total: officialItems.length,
      has_more: options.offset + pagedItems.length < officialItems.length,
    };
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
    // Even with no DB repos, official packages should still appear
    const officialOnly = options.offset === 0
      ? filterOfficialPackages({
          searchQuery: options.searchQuery,
          category: options.category,
          type: options.type,
          tagsRaw: options.tagsRaw,
          certifiedOnly: options.certifiedOnly,
        })
      : [];
    const pagedOfficial = officialOnly.slice(options.offset, options.offset + options.limit);
    return {
      items: pagedOfficial,
      total: officialOnly.length,
      has_more: options.offset + pagedOfficial.length < officialOnly.length,
    };
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

  // Merge official packages on the first page
  const officialItems = options.offset === 0
    ? filterOfficialPackages({
        searchQuery: options.searchQuery,
        category: options.category,
        type: options.type,
        tagsRaw: options.tagsRaw,
        certifiedOnly: options.certifiedOnly,
      })
    : [];

  // Deduplicate: remove DB items whose repo name matches an official package id
  const officialIds = new Set(officialItems.map((item) => item.repo.id));
  const deduplicatedItems = items.filter((item) => !officialIds.has(item.repo.id));

  // Prepend official packages before DB results
  const merged = [...officialItems, ...deduplicatedItems];

  const total = merged.length;
  const pagedItems = merged.slice(options.offset, options.offset + options.limit);

  return {
    items: pagedItems,
    total,
    has_more: options.offset + pagedItems.length < total,
  };
}
