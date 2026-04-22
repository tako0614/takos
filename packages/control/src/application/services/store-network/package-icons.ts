import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  getDb,
  repoReleaseAssets,
  repoReleases,
} from "../../../infra/db/index.ts";
import type { D1Database } from "../../../shared/types/bindings.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";

type BundleMetaWithIcon = {
  icon?: unknown;
};

export async function resolvePackageIconsForRepos(
  dbBinding: D1Database,
  repoIds: string[],
): Promise<Map<string, string>> {
  const uniqueRepoIds = Array.from(new Set(repoIds.filter(Boolean)));
  if (uniqueRepoIds.length === 0) return new Map();

  const db = getDb(dbBinding);
  const releases = await db.select({
    id: repoReleases.id,
    repoId: repoReleases.repoId,
  })
    .from(repoReleases)
    .where(and(
      inArray(repoReleases.repoId, uniqueRepoIds),
      eq(repoReleases.isDraft, false),
      eq(repoReleases.isPrerelease, false),
    ))
    .orderBy(desc(repoReleases.publishedAt), desc(repoReleases.createdAt))
    .all();

  const latestReleaseIdByRepoId = new Map<string, string>();
  const repoIdByReleaseId = new Map<string, string>();
  for (const release of releases) {
    if (latestReleaseIdByRepoId.has(release.repoId)) continue;
    latestReleaseIdByRepoId.set(release.repoId, release.id);
    repoIdByReleaseId.set(release.id, release.repoId);
  }

  const latestReleaseIds = Array.from(latestReleaseIdByRepoId.values());
  if (latestReleaseIds.length === 0) return new Map();

  const assetRows = await db.select({
    releaseId: repoReleaseAssets.releaseId,
    bundleMetaJson: repoReleaseAssets.bundleMetaJson,
  })
    .from(repoReleaseAssets)
    .where(inArray(repoReleaseAssets.releaseId, latestReleaseIds))
    .orderBy(asc(repoReleaseAssets.createdAt))
    .all();

  const firstAssetByReleaseId = new Map<
    string,
    { bundleMetaJson: string | null }
  >();
  for (const asset of assetRows) {
    if (firstAssetByReleaseId.has(asset.releaseId)) continue;
    firstAssetByReleaseId.set(asset.releaseId, {
      bundleMetaJson: asset.bundleMetaJson,
    });
  }

  const icons = new Map<string, string>();
  for (const [releaseId, asset] of firstAssetByReleaseId) {
    const repoId = repoIdByReleaseId.get(releaseId);
    if (!repoId) continue;
    const icon = readBundleIcon(asset.bundleMetaJson);
    if (icon) icons.set(repoId, icon);
  }
  return icons;
}

function readBundleIcon(bundleMetaJson: string | null): string | null {
  if (!bundleMetaJson) return null;
  const bundleMeta = safeJsonParseOrDefault<BundleMetaWithIcon | null>(
    bundleMetaJson,
    null,
  );
  const icon = typeof bundleMeta?.icon === "string"
    ? bundleMeta.icon.trim()
    : "";
  return icon || null;
}
