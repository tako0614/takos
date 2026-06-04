import type { Env } from "../../../shared/types/index.ts";
import type { ObjectStoreBinding } from "../../../shared/types/bindings.ts";
import {
  repoReleaseAssets,
  repoReleases,
  repositories,
} from "../../../infra/db/index.ts";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { toReleaseAssets } from "./repo-release-assets.ts";
import { selectInstallableSourcePathFromRepo } from "./opentofu-app-manifest.ts";
import type {
  CatalogDeploySourceResponse,
  CatalogItemResponse,
  CatalogResult,
  CatalogSort,
  CatalogType,
  ParsedCatalogRelease,
  RepositoryWithAccount,
} from "./explore-types.ts";
import {
  buildBaseConditions,
  computeTrendingScore,
  getStarredRepoIds,
  parseCatalogTags,
  queryReposWithAccount,
  resolveAccountOwner,
} from "./source-exploration.ts";
import { fetchPublishStatuses } from "./explore-stats.ts";
import { sourceServiceDeps } from "./deps.ts";
import type { DefaultAppDistributionEntry } from "./default-app-distribution.ts";
import {
  type AccountsInstallationProjection,
  type CatalogAccountsInstallationsReadConfig,
  fetchAccountsInstallationsForSpace,
  setLatestAccountsInstallation,
} from "./explore-catalog-accounts.ts";
import {
  accountsSourceKeys,
  type CatalogInstallationProjection,
  defaultAppPackageAppId,
  defaultAppSourceKey,
  mapCatalogInstallationResponse,
  mapDefaultAppCatalogItem,
  normalizeCatalogRepositoryUrlKey,
  shouldIncludeDefaultAppEntry,
  toCatalogInstallationProjection,
} from "./explore-catalog-default-apps.ts";

export type {
  CatalogAccountsInstallationsEnv,
  CatalogAccountsInstallationsReadConfig,
} from "./explore-catalog-accounts.ts";
export { resolveCatalogAccountsInstallationsReadConfig } from "./explore-catalog-accounts.ts";

function isDirectoryEntry(entry: { mode: string }): boolean {
  return entry.mode === "040000" || entry.mode === "40000";
}

async function listRepoSourcePaths(
  gitObjects: ObjectStoreBinding,
  treeSha: string,
): Promise<string[] | null> {
  const rootEntries = await sourceServiceDeps.gitStore.listDirectory(
    gitObjects,
    treeSha,
  );
  if (!rootEntries) return null;

  const paths = rootEntries.map((entry) => entry.name);
  for (const dirName of ["opentofu", "infra"]) {
    const dir = rootEntries.find((entry) =>
      entry.name === dirName && isDirectoryEntry(entry)
    );
    if (!dir) continue;
    const entries = await sourceServiceDeps.gitStore.listDirectory(
      gitObjects,
      treeSha,
      dirName,
    );
    if (entries) {
      paths.push(...entries.map((entry) => `${dirName}/${entry.name}`));
    }
  }

  return paths;
}

export async function hasDeployManifestForRelease(
  dbBinding: Env["DB"],
  gitObjects: ObjectStoreBinding | undefined,
  release: { repoId: string; tag: string; commitSha: string | null },
): Promise<boolean> {
  if (!gitObjects) return false;

  try {
    const commitSha = release.commitSha ||
      await sourceServiceDeps.gitStore.resolveRef(
        dbBinding,
        release.repoId,
        `refs/tags/${release.tag}`,
      ) ||
      await sourceServiceDeps.gitStore.resolveRef(
        dbBinding,
        release.repoId,
        release.tag,
      );
    if (!commitSha) return false;

    const commit = await sourceServiceDeps.gitStore.getCommitData(
      gitObjects,
      commitSha,
    );
    if (!commit?.tree) return false;

    const sourcePath = selectInstallableSourcePathFromRepo(
      await listRepoSourcePaths(gitObjects, commit.tree) ?? [],
    );
    if (!sourcePath) return false;

    const sourceBlob = await sourceServiceDeps.gitStore.getBlobAtPath(
      gitObjects,
      commit.tree,
      sourcePath,
    );
    return !!sourceBlob;
  } catch (error) {
    sourceServiceDeps.logWarn("Failed to verify release source for catalog", {
      repoId: release.repoId,
      tag: release.tag,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function normalizeRepositoryBaseUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed)
    ? trimmed.replace(/\/+$/, "")
    : `https://${trimmed.replace(/\/+$/, "")}`;
}

function buildCatalogRepositoryUrl(
  repositoryBaseUrl: string | undefined,
  ownerSlug: string,
  repoName: string,
): string | null {
  const base = normalizeRepositoryBaseUrl(repositoryBaseUrl);
  if (!base) return null;
  return `${base}/git/${encodeURIComponent(ownerSlug)}/${
    encodeURIComponent(repoName)
  }.git`;
}

function packageDeploySource(
  repo: RepositoryWithAccount,
  release: ParsedCatalogRelease | undefined,
  repositoryBaseUrl: string | undefined,
): CatalogDeploySourceResponse | undefined {
  if (!release) return undefined;
  const repositoryUrl = buildCatalogRepositoryUrl(
    repositoryBaseUrl,
    repo.account.slug,
    repo.name,
  ) ?? repo.remoteCloneUrl;
  if (!repositoryUrl) return undefined;
  return {
    kind: "git_ref",
    repository_url: repositoryUrl,
    ref: release.releaseTag,
    ref_type: "tag",
    backend: null,
    env: "staging",
  };
}

export async function listCatalogItems(
  dbBinding: Env["DB"],
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
    gitObjects?: ObjectStoreBinding;
    repositoryBaseUrl?: string;
    defaultAppEntries?: DefaultAppDistributionEntry[];
    accountsInstallations?: CatalogAccountsInstallationsReadConfig;
    now?: string;
  },
): Promise<CatalogResult> {
  const db = sourceServiceDeps.getDb(dbBinding);

  const parsedTags = parseCatalogTags(options.tagsRaw);
  if (parsedTags.invalid) {
    return { items: [], total: 0, has_more: false };
  }

  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: options.since,
    sinceField: "updatedAt",
    searchQuery: options.searchQuery?.trim() || undefined,
  });

  const repos = await queryReposWithAccount(dbBinding, {
    conditions,
    orderBy: [desc(repositories.stars)],
  });

  const repoIds = repos.map((repo) => repo.id);
  const starredRepoIds = await getStarredRepoIds(
    dbBinding,
    options.userId,
    repoIds,
  );

  const releases = repoIds.length > 0
    ? await db.select({
      id: repoReleases.id,
      repoId: repoReleases.repoId,
      tag: repoReleases.tag,
      commitSha: repoReleases.commitSha,
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
      .all()
    : [];

  // Fetch assets for these releases
  const releaseIds = releases.map((r) => r.id);
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

  const latestReleaseByRepoId = new Map<string, ParsedCatalogRelease>();
  const hasManifestByReleaseId = new Map<string, boolean>();
  for (const release of releases) {
    if (latestReleaseByRepoId.has(release.repoId)) continue;

    let hasManifest = hasManifestByReleaseId.get(release.id);
    if (hasManifest === undefined) {
      hasManifest = await hasDeployManifestForRelease(
        dbBinding,
        options.gitObjects,
        {
          repoId: release.repoId,
          tag: release.tag,
          commitSha: release.commitSha ?? null,
        },
      );
      hasManifestByReleaseId.set(release.id, hasManifest);
    }
    if (!hasManifest) continue;

    const releaseAssetRows = assetsByRelease.get(release.id) || [];
    const assets = toReleaseAssets(releaseAssetRows);
    const primaryAsset = assets[0];
    const totalDownloads = assets.reduce(
      (sum, asset) => sum + (asset.download_count || 0),
      0,
    );
    latestReleaseByRepoId.set(release.repoId, {
      releaseId: release.id,
      repoId: release.repoId,
      appId: primaryAsset?.bundle_meta?.app_id ||
        primaryAsset?.bundle_meta?.name || release.repoName,
      releaseTag: release.tag,
      publishedAt: release.publishedAt ?? null,
      version: primaryAsset?.bundle_meta?.version || release.tag,
      description: primaryAsset?.bundle_meta?.description ||
        release.description || null,
      icon: primaryAsset?.bundle_meta?.icon || null,
      category: primaryAsset?.bundle_meta?.category || null,
      tags: Array.isArray(primaryAsset?.bundle_meta?.tags)
        ? primaryAsset.bundle_meta.tags.filter((tag): tag is string =>
          typeof tag === "string"
        )
        : [],
      assetId: primaryAsset?.id || null,
      downloadCount: primaryAsset?.download_count || 0,
      totalDownloads,
    });
  }

  const publishStatusMap = await fetchPublishStatuses(
    db,
    Array.from(latestReleaseByRepoId.values())
      .flatMap((release) =>
        release.assetId
          ? [{
            repoId: release.repoId,
            releaseTag: release.releaseTag,
            assetId: release.assetId,
          }]
          : []
      ),
  );

  const reviewMap = new Map<
    string,
    { ratingAvg: number | null; ratingCount: number }
  >();

  const appInstallationMap = new Map<string, CatalogInstallationProjection>();
  if (options.spaceId) {
    const accountsInstallations = await fetchAccountsInstallationsForSpace(
      options.spaceId,
      options.accountsInstallations,
    );
    const accountsInstallationByKey = new Map<
      string,
      AccountsInstallationProjection
    >();
    for (const installation of accountsInstallations) {
      setLatestAccountsInstallation(
        accountsInstallationByKey,
        installation.appId,
        installation,
      );
      for (const sourceKey of accountsSourceKeys(installation)) {
        setLatestAccountsInstallation(
          accountsInstallationByKey,
          sourceKey,
          installation,
        );
      }
    }
    for (const [key, installation] of accountsInstallationByKey) {
      appInstallationMap.set(
        key,
        toCatalogInstallationProjection(installation),
      );
    }
  }

  const mappedItems = repos.map((repo): CatalogItemResponse | null => {
    const packageRelease = latestReleaseByRepoId.get(repo.id);
    const review = reviewMap.get(repo.id);
    const publishStatus = packageRelease?.assetId
      ? (publishStatusMap.get(
        `${packageRelease.releaseId}:${packageRelease.assetId}`,
      ) || "none")
      : "none";
    const source = packageDeploySource(
      repo,
      packageRelease,
      options.repositoryBaseUrl,
    );
    const sourceAppInstallation = source
      ? appInstallationMap.get(defaultAppSourceKey({
        repositoryUrl: source.repository_url,
        ref: source.ref,
        refType: source.ref_type,
      }))
      : undefined;
    const packageAppInstallation = packageRelease?.appId
      ? appInstallationMap.get(packageRelease.appId)
      : undefined;
    const installation = options.spaceId
      ? packageAppInstallation ?? sourceAppInstallation
      : undefined;
    const packageInfo = {
      available: !!packageRelease,
      app_id: packageRelease?.appId || null,
      latest_version: packageRelease?.version || null,
      latest_tag: packageRelease?.releaseTag || null,
      release_id: packageRelease?.releaseId || null,
      release_tag: packageRelease?.releaseTag || null,
      asset_id: packageRelease?.assetId || null,
      description: packageRelease?.description || null,
      icon: packageRelease?.icon || null,
      category: packageRelease?.category || null,
      tags: packageRelease?.tags || [],
      downloads: packageRelease?.totalDownloads || 0,
      rating_avg: review?.ratingAvg ?? null,
      rating_count: review?.ratingCount ?? 0,
      publish_status: publishStatus,
      certified: publishStatus === "approved",
      published_at: packageRelease?.publishedAt || null,
    };

    const item: CatalogItemResponse = {
      repo: {
        id: repo.id,
        name: repo.name,
        description: repo.description,
        visibility: "public",
        default_branch: repo.defaultBranch,
        stars: repo.stars,
        forks: repo.forks,
        category: packageRelease?.category || null,
        language: repo.primaryLanguage || null,
        license: repo.license || null,
        is_starred: starredRepoIds.has(repo.id),
        created_at: repo.createdAt || "",
        updated_at: repo.updatedAt || "",
        space: {
          id: repo.account.id,
          name: repo.account.name,
        },
        owner: resolveAccountOwner(repo.account),
        catalog_origin: "repository",
      },
      package: packageInfo,
    };

    if (source) {
      item.source = source;
    }

    if (options.spaceId) {
      item.installation = mapCatalogInstallationResponse(installation);
    }

    if (options.type === "repo") {
      return item;
    }

    return item;
  });

  let items: CatalogItemResponse[] = mappedItems.filter(
    (item): item is CatalogItemResponse => item !== null,
  );

  const repositoryUrlKeys = new Set(
    repos
      .map((repo) => repo.remoteCloneUrl)
      .filter((url): url is string => typeof url === "string" && !!url.trim())
      .map(normalizeCatalogRepositoryUrlKey),
  );
  const defaultAppTimestamp = options.now ?? new Date().toISOString();
  const defaultAppItems = (options.defaultAppEntries ?? [])
    .filter((entry) =>
      !repositoryUrlKeys.has(normalizeCatalogRepositoryUrlKey(
        entry.repositoryUrl,
      )) &&
      shouldIncludeDefaultAppEntry(entry, options, parsedTags)
    )
    .map((entry) =>
      mapDefaultAppCatalogItem(
        entry,
        appInstallationMap.get(defaultAppPackageAppId(entry)) ??
          appInstallationMap.get(defaultAppSourceKey(entry)),
        defaultAppTimestamp,
      )
    );
  items = [...items, ...defaultAppItems];

  if (options.type === "deployable-app") {
    items = items.filter((item) => item.package.available);
  }

  if (options.category) {
    items = items.filter((item) => item.package.category === options.category);
  }

  if (parsedTags.tags.length > 0) {
    items = items.filter((item) => {
      if (!item.package.available) return false;
      const packageTags = item.package.tags.map((tag) =>
        tag.trim().toLowerCase()
      ).filter(Boolean);
      return parsedTags.tags.every((tag) => packageTags.includes(tag));
    });
  }

  if (options.certifiedOnly) {
    items = items.filter((item) => item.package.certified);
  }

  const sort = options.sort;
  items.sort((left, right) => {
    if (sort === "downloads") {
      const byDownloads = right.package.downloads - left.package.downloads;
      if (byDownloads !== 0) return byDownloads;
      return right.repo.stars - left.repo.stars;
    }

    if (sort === "new") {
      const leftMs =
        Date.parse(left.package.published_at || left.repo.created_at) || 0;
      const rightMs =
        Date.parse(right.package.published_at || right.repo.created_at) || 0;
      if (rightMs !== leftMs) return rightMs - leftMs;
      return right.repo.stars - left.repo.stars;
    }

    if (sort === "updated") {
      const leftMs = Date.parse(left.repo.updated_at) || 0;
      const rightMs = Date.parse(right.repo.updated_at) || 0;
      if (rightMs !== leftMs) return rightMs - leftMs;
      return right.repo.stars - left.repo.stars;
    }

    if (sort === "trending") {
      const leftScore = computeTrendingScore({
        stars: left.repo.stars,
        downloads: left.package.downloads,
        updatedAtMs: Date.parse(left.repo.updated_at) || 0,
      });
      const rightScore = computeTrendingScore({
        stars: right.repo.stars,
        downloads: right.package.downloads,
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
  const pagedItems = items.slice(
    options.offset,
    options.offset + options.limit,
  );

  return {
    items: pagedItems,
    total,
    has_more: options.offset + pagedItems.length < total,
  };
}
