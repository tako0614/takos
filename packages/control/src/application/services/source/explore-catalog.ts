import type { Env } from "../../../shared/types/index.ts";
import type { R2Bucket } from "../../../shared/types/bindings.ts";
import {
  groupDeploymentSnapshots,
  groups,
  repoReleaseAssets,
  repoReleases,
  repositories,
} from "../../../infra/db/index.ts";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { toReleaseAssets } from "./repo-release-assets.ts";
import { selectAppManifestPathFromRepo } from "./app-manifest-bundle.ts";
import type {
  CatalogDeploySourceResponse,
  CatalogItemResponse,
  CatalogResult,
  CatalogSort,
  CatalogType,
  ParsedCatalogRelease,
  ParsedCatalogTags,
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
import { repositoryUrlKey } from "../platform/group-deployment-snapshot-source.ts";

function isDirectoryEntry(entry: { mode: string }): boolean {
  return entry.mode === "040000" || entry.mode === "40000";
}

async function listRepoManifestPaths(
  gitObjects: R2Bucket,
  treeSha: string,
): Promise<string[] | null> {
  const rootEntries = await sourceServiceDeps.gitStore.listDirectory(
    gitObjects,
    treeSha,
  );
  if (!rootEntries) return null;

  const paths = rootEntries.map((entry) => entry.name);
  const takosDir = rootEntries.find((entry) =>
    entry.name === ".takos" && isDirectoryEntry(entry)
  );
  if (takosDir) {
    const takosEntries = await sourceServiceDeps.gitStore.listDirectory(
      gitObjects,
      treeSha,
      ".takos",
    );
    if (takosEntries) {
      paths.push(...takosEntries.map((entry) => `.takos/${entry.name}`));
    }
  }

  return paths;
}

export async function hasDeployManifestForRelease(
  dbBinding: Env["DB"],
  gitObjects: R2Bucket | undefined,
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

    const manifestPath = selectAppManifestPathFromRepo(
      await listRepoManifestPaths(gitObjects, commit.tree) ?? [],
    );
    if (!manifestPath) return false;

    const manifestBlob = await sourceServiceDeps.gitStore.getBlobAtPath(
      gitObjects,
      commit.tree,
      manifestPath,
    );
    return !!manifestBlob;
  } catch (error) {
    sourceServiceDeps.logWarn("Failed to verify release manifest for catalog", {
      repoId: release.repoId,
      tag: release.tag,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function parseManifestVersion(manifestJson: string | null): string | null {
  if (!manifestJson) return null;
  try {
    const manifest = JSON.parse(manifestJson) as { version?: unknown };
    return typeof manifest.version === "string" && manifest.version.trim()
      ? manifest.version
      : null;
  } catch {
    return null;
  }
}

function normalizeCatalogRepositoryUrlKey(repositoryUrl: string): string {
  try {
    return repositoryUrlKey(repositoryUrl);
  } catch {
    return repositoryUrl.trim().replace(/\/+$/, "").replace(/\.git$/i, "")
      .toLowerCase();
  }
}

function defaultAppCatalogId(name: string): string {
  return `default-app:${name}`;
}

function defaultAppSourceKey(input: {
  repositoryUrl: string;
  ref: string;
  refType: string;
}): string {
  return `${
    normalizeCatalogRepositoryUrlKey(input.repositoryUrl)
  }#${input.refType}:${input.ref}`;
}

function snapshotSourceKey(input: {
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
}): string | null {
  if (!input.sourceRepositoryUrl || !input.sourceRef || !input.sourceRefType) {
    return null;
  }
  return defaultAppSourceKey({
    repositoryUrl: input.sourceRepositoryUrl,
    ref: input.sourceRef,
    refType: input.sourceRefType,
  });
}

function defaultAppTags(entry: DefaultAppDistributionEntry): string[] {
  return Array.from(
    new Set(
      [
        "default",
        "default-app",
        "takos",
        entry.name,
        ...entry.name.split(/[-_\s]+/g),
      ].map((tag) => tag.trim().toLowerCase()).filter((tag) =>
        tag && /^[a-z0-9][a-z0-9_-]*$/.test(tag)
      ),
    ),
  ).slice(0, 10);
}

function defaultAppDescription(entry: DefaultAppDistributionEntry): string {
  return `Official Takos default app deployed from ${entry.repositoryUrl}`;
}

function matchesDefaultAppSearch(
  entry: DefaultAppDistributionEntry,
  tags: string[],
  searchQuery: string | undefined,
): boolean {
  const query = searchQuery?.trim().toLowerCase();
  if (!query) return true;
  return [
    entry.name,
    entry.title,
    entry.repositoryUrl,
    defaultAppDescription(entry),
    ...tags,
  ].some((value) => value.toLowerCase().includes(query));
}

function shouldIncludeDefaultAppEntry(
  entry: DefaultAppDistributionEntry,
  options: {
    searchQuery?: string;
    type?: CatalogType;
    category?: string;
    certifiedOnly?: boolean;
  },
  parsedTags: ParsedCatalogTags,
): boolean {
  const tags = defaultAppTags(entry);
  if (!matchesDefaultAppSearch(entry, tags, options.searchQuery)) return false;
  if (options.type === "repo") return true;
  if (options.category && options.category !== "app") return false;
  if (parsedTags.tags.length > 0) {
    return parsedTags.tags.every((tag) => tags.includes(tag));
  }
  if (options.certifiedOnly === true) return true;
  return true;
}

function mapDefaultAppCatalogItem(
  entry: DefaultAppDistributionEntry,
  installation:
    | { id: string; version: string | null; deployedAt: string }
    | undefined,
  timestamp: string,
): CatalogItemResponse {
  const tags = defaultAppTags(entry);
  const description = defaultAppDescription(entry);
  const source: CatalogDeploySourceResponse = {
    kind: "git_ref",
    repository_url: entry.repositoryUrl,
    ref: entry.ref,
    ref_type: entry.refType,
    backend: entry.backendName ?? null,
    env: entry.envName ?? null,
  };
  const item: CatalogItemResponse = {
    repo: {
      id: defaultAppCatalogId(entry.name),
      name: entry.title || entry.name,
      description,
      visibility: "public",
      default_branch: entry.refType === "branch" ? entry.ref : "main",
      stars: 0,
      forks: 0,
      category: "app",
      language: "TypeScript",
      license: null,
      is_starred: false,
      created_at: timestamp,
      updated_at: timestamp,
      space: {
        id: "takos-default-apps",
        name: "Takos Default Apps",
      },
      owner: {
        id: "takos",
        name: "Takos",
        username: "takos",
        avatar_url: null,
      },
      catalog_origin: "default_app",
    },
    package: {
      available: true,
      app_id: entry.name,
      latest_version: entry.refType === "tag" ? entry.ref : null,
      latest_tag: entry.refType === "tag" ? entry.ref : null,
      release_id: null,
      release_tag: entry.refType === "tag" ? entry.ref : null,
      asset_id: null,
      description,
      icon: null,
      category: "app",
      tags,
      downloads: 0,
      rating_avg: null,
      rating_count: 0,
      publish_status: "approved",
      certified: true,
      published_at: timestamp,
    },
    source,
  };
  if (installation) {
    item.installation = {
      installed: true,
      group_deployment_snapshot_id: installation.id,
      installed_version: installation.version,
      deployed_at: installation.deployedAt,
    };
  }
  return item;
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
    gitObjects?: R2Bucket;
    repositoryBaseUrl?: string;
    defaultAppEntries?: DefaultAppDistributionEntry[];
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
      .filter((release) => !!release.assetId)
      .map((release) => ({
        repoId: release.repoId,
        releaseTag: release.releaseTag,
        assetId: release.assetId!,
      })),
  );

  const reviewMap = new Map<
    string,
    { ratingAvg: number | null; ratingCount: number }
  >();

  const installationMap = new Map<string, {
    id: string;
    version: string | null;
    deployedAt: string;
  }>();
  const sourceInstallationMap = new Map<string, {
    id: string;
    version: string | null;
    deployedAt: string;
  }>();
  if (options.spaceId) {
    const installs = await db.select({
      id: groupDeploymentSnapshots.id,
      sourceRepoId: groupDeploymentSnapshots.sourceRepoId,
      sourceResolvedRepoId: groupDeploymentSnapshots.sourceResolvedRepoId,
      sourceRepositoryUrl: groupDeploymentSnapshots.sourceRepositoryUrl,
      sourceVersion: groupDeploymentSnapshots.sourceVersion,
      sourceTag: groupDeploymentSnapshots.sourceTag,
      sourceRef: groupDeploymentSnapshots.sourceRef,
      sourceRefType: groupDeploymentSnapshots.sourceRefType,
      manifestJson: groupDeploymentSnapshots.manifestJson,
      deployedAt: groupDeploymentSnapshots.createdAt,
    }).from(groupDeploymentSnapshots)
      .innerJoin(
        groups,
        eq(
          groups.currentGroupDeploymentSnapshotId,
          groupDeploymentSnapshots.id,
        ),
      )
      .where(and(
        eq(groupDeploymentSnapshots.spaceId, options.spaceId),
        eq(groups.spaceId, options.spaceId),
        eq(groupDeploymentSnapshots.sourceKind, "git_ref"),
        eq(groupDeploymentSnapshots.status, "applied"),
      ))
      .orderBy(desc(groupDeploymentSnapshots.createdAt))
      .all();
    for (const install of installs) {
      const installedVersion = parseManifestVersion(install.manifestJson) ||
        install.sourceVersion || install.sourceTag || install.sourceRef || null;
      const installation = {
        id: install.id,
        version: installedVersion,
        deployedAt: install.deployedAt || "",
      };
      const sourceRepoIds = Array.from(
        new Set([install.sourceResolvedRepoId, install.sourceRepoId].filter((
          repoId,
        ): repoId is string =>
          typeof repoId === "string" && repoId.length > 0
        )),
      );
      for (const sourceRepoId of sourceRepoIds) {
        if (!installationMap.has(sourceRepoId)) {
          installationMap.set(sourceRepoId, installation);
        }
      }
      const sourceKey = snapshotSourceKey(install);
      if (sourceKey && !sourceInstallationMap.has(sourceKey)) {
        sourceInstallationMap.set(sourceKey, installation);
      }
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
    const sourceInstallation = source
      ? sourceInstallationMap.get(defaultAppSourceKey({
        repositoryUrl: source.repository_url,
        ref: source.ref,
        refType: source.ref_type,
      }))
      : undefined;
    const installation = options.spaceId
      ? installationMap.get(repo.id) ?? sourceInstallation
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
      item.installation = {
        installed: !!installation,
        group_deployment_snapshot_id: installation?.id || null,
        installed_version: installation?.version || null,
        deployed_at: installation?.deployedAt || null,
      };
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
        sourceInstallationMap.get(defaultAppSourceKey(entry)),
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
