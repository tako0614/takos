// ---------------------------------------------------------------------------
// explore-packages.ts — main entry point that composes search, filter, stats
// ---------------------------------------------------------------------------

import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import {
  accounts,
  getDb,
  repoReleaseAssets,
  repoReleases,
  repositories,
} from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import type {
  PackageDto,
  PackageRatingStats,
  PackageWithRelease,
  ReleaseAsset,
  SearchPackagesParams,
  SearchPackagesResult,
  SuggestPackageDto,
  SuggestPackagesParams,
} from "./explore-package-types.ts";
import {
  buildPackagesFromRows,
  loadAssetsForReleases,
  queryReleasesWithRepo,
} from "./explore-search.ts";
import {
  filterPackages,
  SORT_ALIASES,
  sortPackages,
} from "./explore-package-filters.ts";
import {
  fetchPublishStatuses,
  getPackageRatingStats,
  getPackageRatingSummary,
  type PublishStatus,
} from "./explore-stats.ts";
import { hasInstallableCapsuleForRelease } from "./explore-catalog.ts";
import { toReleaseAssets } from "./repo-release-assets.ts";
import { textDateNullable } from "../../../shared/utils/db-guards.ts";
import type { ObjectStoreBinding } from "../../../shared/types/bindings.ts";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Public type and function exports for package exploration callers.
// ---------------------------------------------------------------------------

export type {
  PackageDto,
  SearchPackagesParams,
  SearchPackagesResult,
  SuggestPackageDto,
  SuggestPackagesParams,
} from "./explore-package-types.ts";

export {
  getPackageRatingStats,
  getPackageRatingSummary,
} from "./explore-stats.ts";

export async function filterDeployablePackageReleases(
  dbBinding: SqlDatabaseBinding,
  gitObjects: ObjectStoreBinding | undefined,
  releases: Array<{
    repoId: string;
    tag: string;
    commitSha: string | null;
  }>,
): Promise<
  Array<{
    repoId: string;
    tag: string;
    commitSha: string | null;
  }>
> {
  const deployable: Array<{
    repoId: string;
    tag: string;
    commitSha: string | null;
  }> = [];

  for (const release of releases) {
    if (await hasInstallableCapsuleForRelease(dbBinding, gitObjects, release)) {
      deployable.push(release);
    }
  }

  return deployable;
}

export type ExplorePackageRepository = {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  stars: number;
  owner_id: string;
  owner_name: string;
  owner_username: string;
  owner_avatar_url: string | null;
};

export type ExplorePackageLatestDto = {
  name: string;
  app_id: string;
  version: string;
  repository_url: string;
  description: string | null;
  icon?: string;
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
  };
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
  } | null;
  published_at: string | null;
  rating_avg: number | null;
  rating_count: number;
};

export type ExplorePackageVersionDto = {
  tag: string;
  app_id: string;
  version: string;
  repository_url: string;
  is_prerelease: boolean;
  asset_id: string | null;
  size: number | null;
  download_count: number;
  published_at: string | null;
};

export type ExplorePackageReviewsResult = {
  repo: { id: string; name: string };
  rating: PackageRatingStats;
  reviews: unknown[];
  viewer_review: null;
  has_more: boolean;
};

export type ExplorePackageNotFoundResource = "Repository" | "Release";

export type LatestExplorePackageResult =
  | { ok: true; package: ExplorePackageLatestDto }
  | { ok: false; resource: ExplorePackageNotFoundResource };

export type ExplorePackageVersionsResult =
  | { ok: true; versions: ExplorePackageVersionDto[] }
  | { ok: false; resource: "Repository" };

export type LoadExplorePackageReviewsResult =
  | { ok: true; body: ExplorePackageReviewsResult }
  | { ok: false; resource: "Repository" };

type LatestPackageSelection = {
  release: {
    id: string;
    tag: string;
    commitSha: string | null;
    description: string | null;
    publishedAt: string | Date | null;
  };
  asset: ReleaseAsset | null;
};

type ExplorePackageLookupParams = {
  username: string;
  repoName: string;
  gitObjects?: ObjectStoreBinding;
  repositoryBaseUrl?: string;
};

function buildRepositoryUrl(
  repositoryBaseUrl: string | undefined,
  ownerUsername: string,
  repoName: string,
): string {
  const adminDomain = String(repositoryBaseUrl || "").trim();
  const base = /^https?:\/\//i.test(adminDomain)
    ? adminDomain.replace(/\/+$/, "")
    : `https://${adminDomain.replace(/\/+$/, "")}`;
  return `${base}/git/${encodeURIComponent(ownerUsername)}/${encodeURIComponent(
    repoName,
  )}.git`;
}

async function findRepoByUsernameAndName(
  db: Database,
  username: string,
  repoName: string,
): Promise<ExplorePackageRepository | null> {
  const cleanUsername = username.trim().toLowerCase();
  const cleanRepoName = repoName.trim().toLowerCase();

  const row = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      visibility: repositories.visibility,
      stars: repositories.stars,
      owner_id: accounts.id,
      owner_name: accounts.name,
      owner_username: accounts.slug,
      owner_avatar_url: accounts.picture,
    })
    .from(repositories)
    .innerJoin(accounts, eq(accounts.id, repositories.accountId))
    .where(
      and(
        sql`lower(${repositories.name}) = ${cleanRepoName}`,
        sql`lower(${accounts.slug}) = ${cleanUsername}`,
      ),
    )
    .limit(1)
    .get();

  return row ?? null;
}

async function loadLatestDeployablePackage(
  db: Database,
  dbBinding: SqlDatabaseBinding,
  gitObjects: ObjectStoreBinding | undefined,
  repoId: string,
): Promise<LatestPackageSelection | null> {
  const pageSize = 10;

  for (let offset = 0; ; offset += pageSize) {
    const releaseRows = await db
      .select()
      .from(repoReleases)
      .where(
        and(
          eq(repoReleases.repoId, repoId),
          eq(repoReleases.isDraft, false),
          eq(repoReleases.isPrerelease, false),
        ),
      )
      .orderBy(desc(repoReleases.publishedAt))
      .limit(pageSize)
      .offset(offset)
      .all();

    if (releaseRows.length === 0) {
      return null;
    }

    const deployableReleaseRows = await filterDeployablePackageReleases(
      dbBinding,
      gitObjects,
      releaseRows.map((release) => ({
        repoId,
        tag: release.tag,
        commitSha: release.commitSha ?? null,
      })),
    );

    if (deployableReleaseRows.length === 0) {
      continue;
    }

    const deployableTags = new Set(
      deployableReleaseRows.map((release) => release.tag),
    );
    const latestRelease = releaseRows.find((release) =>
      deployableTags.has(release.tag),
    );
    if (!latestRelease) {
      continue;
    }

    const assets = await db
      .select()
      .from(repoReleaseAssets)
      .where(eq(repoReleaseAssets.releaseId, latestRelease.id))
      .orderBy(asc(repoReleaseAssets.createdAt))
      .all();

    return {
      release: latestRelease,
      asset: toReleaseAssets(assets)[0] ?? null,
    };
  }
}

export async function loadLatestExplorePackage(
  dbBinding: SqlDatabaseBinding,
  params: ExplorePackageLookupParams,
): Promise<LatestExplorePackageResult> {
  const db = getDb(dbBinding);
  const repo = await findRepoByUsernameAndName(
    db,
    params.username,
    params.repoName,
  );

  if (!repo || repo.visibility !== "public") {
    return { ok: false, resource: "Repository" };
  }

  const latestPackage = await loadLatestDeployablePackage(
    db,
    dbBinding,
    params.gitObjects,
    repo.id,
  );

  if (!latestPackage) {
    return { ok: false, resource: "Release" };
  }

  const rating = await getPackageRatingSummary(db, repo.id);

  return {
    ok: true,
    package: {
      name: repo.name,
      app_id:
        latestPackage.asset?.bundle_meta?.app_id ||
        latestPackage.asset?.bundle_meta?.name ||
        repo.name,
      version:
        latestPackage.asset?.bundle_meta?.version || latestPackage.release.tag,
      repository_url: buildRepositoryUrl(
        params.repositoryBaseUrl,
        repo.owner_username,
        repo.name,
      ),
      description:
        latestPackage.asset?.bundle_meta?.description ||
        latestPackage.release.description,
      icon: latestPackage.asset?.bundle_meta?.icon,
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
        published_at: textDateNullable(latestPackage.release.publishedAt),
      },
      asset: latestPackage.asset
        ? {
            id: latestPackage.asset.id,
            name: latestPackage.asset.name,
            size: latestPackage.asset.size,
            download_count: latestPackage.asset.download_count,
          }
        : null,
      published_at: textDateNullable(latestPackage.release.publishedAt),
      rating_avg: rating.rating_avg,
      rating_count: rating.rating_count,
    },
  };
}

export async function listExplorePackageVersions(
  dbBinding: SqlDatabaseBinding,
  params: ExplorePackageLookupParams,
): Promise<ExplorePackageVersionsResult> {
  const db = getDb(dbBinding);
  const repo = await findRepoByUsernameAndName(
    db,
    params.username,
    params.repoName,
  );

  if (!repo || repo.visibility !== "public") {
    return { ok: false, resource: "Repository" };
  }

  const releaseRows = await db
    .select()
    .from(repoReleases)
    .where(
      and(eq(repoReleases.repoId, repo.id), eq(repoReleases.isDraft, false)),
    )
    .orderBy(desc(repoReleases.publishedAt))
    .all();

  const deployableReleaseRows = await filterDeployablePackageReleases(
    dbBinding,
    params.gitObjects,
    releaseRows.map((release) => ({
      repoId: repo.id,
      tag: release.tag,
      commitSha: release.commitSha ?? null,
    })),
  );
  const deployableReleaseTags = new Set(
    deployableReleaseRows.map((release) => release.tag),
  );

  const filteredReleaseRows = releaseRows.filter((release) =>
    deployableReleaseTags.has(release.tag),
  );
  const releaseIds = filteredReleaseRows.map((release) => release.id);
  const allAssets =
    releaseIds.length > 0
      ? await db
          .select()
          .from(repoReleaseAssets)
          .where(inArray(repoReleaseAssets.releaseId, releaseIds))
          .orderBy(asc(repoReleaseAssets.createdAt))
          .all()
      : [];
  const assetsByRelease = new Map<string, typeof allAssets>();
  for (const asset of allAssets) {
    const list = assetsByRelease.get(asset.releaseId) ?? [];
    list.push(asset);
    assetsByRelease.set(asset.releaseId, list);
  }

  const versions = filteredReleaseRows.map((release) => {
    const assets = toReleaseAssets(assetsByRelease.get(release.id) ?? []);
    const primaryAsset = assets[0] ?? null;

    return {
      tag: release.tag,
      app_id:
        primaryAsset?.bundle_meta?.app_id ||
        primaryAsset?.bundle_meta?.name ||
        repo.name,
      version: primaryAsset?.bundle_meta?.version || release.tag,
      repository_url: buildRepositoryUrl(
        params.repositoryBaseUrl,
        repo.owner_username,
        repo.name,
      ),
      is_prerelease: release.isPrerelease,
      asset_id: primaryAsset?.id || null,
      size: primaryAsset?.size || null,
      download_count: primaryAsset?.download_count || 0,
      published_at: textDateNullable(release.publishedAt),
    };
  });

  return { ok: true, versions };
}

export async function loadExplorePackageReviews(
  dbBinding: SqlDatabaseBinding,
  repoId: string,
): Promise<LoadExplorePackageReviewsResult> {
  const db = getDb(dbBinding);
  const repo = await db
    .select({
      id: repositories.id,
      name: repositories.name,
    })
    .from(repositories)
    .where(
      and(eq(repositories.id, repoId), eq(repositories.visibility, "public")),
    )
    .get();
  if (!repo) {
    return { ok: false, resource: "Repository" };
  }

  const rating = await getPackageRatingSummary(db, repoId);

  return {
    ok: true,
    body: {
      repo: { id: repo.id, name: repo.name },
      rating,
      reviews: [],
      viewer_review: null,
      has_more: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolvePackageOwner(
  account: PackageWithRelease["release"]["repository"]["account"],
) {
  return {
    id: account.id,
    name: account.name,
    username: account.slug,
    avatar_url: account.picture || null,
  };
}

function toPackageDto(
  pkg: PackageWithRelease,
  ratingStatsByRepoId: Map<string, PackageRatingStats>,
  publishStatusByKey: Map<string, PublishStatus>,
): PackageDto {
  const publishKey = pkg.primaryAsset
    ? `${pkg.release.id}:${pkg.primaryAsset.id}`
    : null;
  const publishStatus = publishKey
    ? publishStatusByKey.get(publishKey) || "none"
    : "none";

  return {
    id: pkg.release.id,
    name: pkg.release.repository.name,
    app_id:
      pkg.primaryAsset?.bundle_meta?.app_id ||
      pkg.primaryAsset?.bundle_meta?.name ||
      pkg.release.repository.name,
    version: pkg.primaryAsset?.bundle_meta?.version || pkg.release.tag,
    description:
      pkg.primaryAsset?.bundle_meta?.description || pkg.release.description,
    icon: pkg.primaryAsset?.bundle_meta?.icon,
    category: pkg.primaryAsset?.bundle_meta?.category,
    tags: pkg.primaryAsset?.bundle_meta?.tags,
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
    asset: pkg.primaryAsset
      ? {
          id: pkg.primaryAsset.id,
          name: pkg.primaryAsset.name,
          size: pkg.primaryAsset.size,
          download_count: pkg.primaryAsset.download_count,
        }
      : null,
    total_downloads: pkg.totalDownloads,
    published_at: textDateNullable(pkg.release.publishedAt),
    rating_avg:
      ratingStatsByRepoId.get(pkg.release.repository.id)?.rating_avg ?? null,
    rating_count:
      ratingStatsByRepoId.get(pkg.release.repository.id)?.rating_count ?? 0,
    publish_status: publishStatus,
    certified: publishStatus === "approved",
  };
}

// ---------------------------------------------------------------------------
// Package search (main orchestrator)
// ---------------------------------------------------------------------------

/**
 * Search, filter, sort, and paginate release-backed packages.
 */
export async function searchPackages(
  d1: SqlDatabaseBinding,
  params: SearchPackagesParams,
): Promise<SearchPackagesResult> {
  const db = getDb(d1);
  const { searchQuery, limit, offset, category, tags, certifiedOnly } = params;
  const sortParam = SORT_ALIASES[params.sortParamRaw] || params.sortParamRaw;

  const ORDER_BY_MAP: Record<string, "updatedAt" | "createdAt" | "downloads"> =
    {
      updated: "updatedAt",
      created: "createdAt",
    };
  const orderByColumn = ORDER_BY_MAP[sortParam] || "downloads";

  const releaseRows = await queryReleasesWithRepo(db, {
    searchQuery: searchQuery || undefined,
    orderByColumn,
    limit: limit + 1,
    offset,
  });

  const releaseIds = releaseRows.map((r) => r.id);
  const assetsByRelease = await loadAssetsForReleases(db, releaseIds);

  const packagesWithRelease = buildPackagesFromRows(
    releaseRows,
    assetsByRelease,
  );

  const hasMore = packagesWithRelease.length > limit;
  if (hasMore) packagesWithRelease.pop();

  let filtered = filterPackages(packagesWithRelease, category, tags);

  const repoIds = Array.from(
    new Set(filtered.map((p) => p.release.repository.id)),
  );
  const ratingStatsByRepoId = await getPackageRatingStats(db, repoIds);

  sortPackages(filtered, sortParam, params.sortParamRaw, ratingStatsByRepoId);

  const publishStatusByKey = await fetchPublishStatuses(
    db,
    filtered.flatMap((pkg) =>
      pkg.primaryAsset
        ? [
            {
              repoId: pkg.release.repository.id,
              releaseTag: pkg.release.tag,
              assetId: pkg.primaryAsset.id,
            },
          ]
        : [],
    ),
  );

  if (certifiedOnly) {
    filtered = filtered.filter(
      (p) =>
        !!p.primaryAsset &&
        publishStatusByKey.get(`${p.release.id}:${p.primaryAsset.id}`) ===
          "approved",
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
  d1: SqlDatabaseBinding,
  params: SuggestPackagesParams,
): Promise<SuggestPackageDto[]> {
  const db = getDb(d1);
  const { query, limit, category, tags } = params;

  const releaseRows = await queryReleasesWithRepo(db, {
    searchQuery: query,
    orderByColumn: "downloads",
    limit: 50,
    offset: 0,
  });

  const releaseIds = releaseRows.map((r) => r.id);
  const assetsByRelease = await loadAssetsForReleases(db, releaseIds);

  const packages = releaseRows
    .map((release) => {
      const assets = assetsByRelease.get(release.id) ?? [];
      const primaryAsset = assets[0] ?? null;
      const totalDownloads = assets.reduce(
        (sum, a) => sum + (a.download_count || 0),
        0,
      );

      return {
        id: release.id,
        name: release.repoName,
        app_id:
          primaryAsset?.bundle_meta?.app_id ||
          primaryAsset?.bundle_meta?.name ||
          release.repoName,
        version: primaryAsset?.bundle_meta?.version || release.tag,
        description:
          primaryAsset?.bundle_meta?.description || release.description,
        icon: primaryAsset?.bundle_meta?.icon,
        category: primaryAsset?.bundle_meta?.category,
        tags: primaryAsset?.bundle_meta?.tags,
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
        asset: primaryAsset
          ? {
              id: primaryAsset.id,
              name: primaryAsset.name,
              size: primaryAsset.size,
              download_count: primaryAsset.download_count,
            }
          : null,
        total_downloads: totalDownloads,
        published_at: textDateNullable(release.publishedAt),
      };
    })
    .filter((p) => {
      if (category && p.category !== category) return false;
      if (tags.length > 0) {
        const pkgTags = (p.tags || [])
          .map((t) =>
            String(t || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean);
        if (pkgTags.length === 0) return false;
        if (!tags.every((t) => pkgTags.includes(t))) return false;
      }
      return true;
    })
    .slice(0, limit);

  return packages;
}
