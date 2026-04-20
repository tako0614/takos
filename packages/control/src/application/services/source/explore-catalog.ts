import type { Env } from "../../../shared/types/index.ts";
import type { R2Bucket } from "../../../shared/types/bindings.ts";
import {
  groupDeploymentSnapshots,
  groups,
  repoReleaseAssets,
  repoReleases,
  repositories,
} from "../../../infra/db/index.ts";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { toReleaseAssets } from "./repo-release-assets.ts";
import { selectAppManifestPathFromRepo } from "./app-manifest-bundle.ts";
import type {
  CatalogItemResponse,
  CatalogResult,
  CatalogSort,
  CatalogType,
  ParsedCatalogRelease,
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

  if (repos.length === 0) {
    return { items: [], total: 0, has_more: false };
  }

  const repoIds = repos.map((repo) => repo.id);
  const starredRepoIds = await getStarredRepoIds(
    dbBinding,
    options.userId,
    repoIds,
  );

  const releases = await db.select({
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
    .all();

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
  if (options.spaceId) {
    const installs = await db.select({
      id: groupDeploymentSnapshots.id,
      sourceRepoId: groupDeploymentSnapshots.sourceRepoId,
      sourceResolvedRepoId: groupDeploymentSnapshots.sourceResolvedRepoId,
      sourceVersion: groupDeploymentSnapshots.sourceVersion,
      sourceTag: groupDeploymentSnapshots.sourceTag,
      sourceRef: groupDeploymentSnapshots.sourceRef,
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
        or(
          inArray(groupDeploymentSnapshots.sourceRepoId, repoIds),
          inArray(groupDeploymentSnapshots.sourceResolvedRepoId, repoIds),
        ),
      ))
      .orderBy(desc(groupDeploymentSnapshots.createdAt))
      .all();
    for (const install of installs) {
      const installedVersion = parseManifestVersion(install.manifestJson) ||
        install.sourceVersion || install.sourceTag || install.sourceRef || null;
      const sourceRepoIds = Array.from(
        new Set([install.sourceResolvedRepoId, install.sourceRepoId].filter((
          repoId,
        ): repoId is string =>
          typeof repoId === "string" && repoId.length > 0
        )),
      );
      for (const sourceRepoId of sourceRepoIds) {
        if (!installationMap.has(sourceRepoId)) {
          installationMap.set(sourceRepoId, {
            id: install.id,
            version: installedVersion,
            deployedAt: install.deployedAt || "",
          });
        }
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
    const installation = options.spaceId
      ? installationMap.get(repo.id)
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
      },
      package: packageInfo,
    };

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
