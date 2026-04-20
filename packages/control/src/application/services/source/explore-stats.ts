// ---------------------------------------------------------------------------
// Rating / stats helpers for release-backed packages
// ---------------------------------------------------------------------------

import { and, desc, eq, inArray } from "drizzle-orm";
import { bundleDeployments, repoReleases } from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import type { PackageRatingStats } from "./explore-package-types.ts";

export type PublishStatus = "none" | "pending" | "approved" | "rejected";

export type PublishStatusTarget = {
  repoId: string;
  releaseTag: string;
  assetId: string;
};

function parsePublishStatusFromRolloutState(
  rolloutState: string | null,
): Exclude<PublishStatus, "none"> {
  if (!rolloutState) return "pending";
  try {
    const parsed = JSON.parse(rolloutState) as { status?: unknown };
    switch (parsed.status) {
      case "completed":
        return "approved";
      case "failed":
      case "aborted":
        return "rejected";
      case "paused":
      case "in_progress":
        return "pending";
      default:
        return "pending";
    }
  } catch {
    return "pending";
  }
}

export async function getPackageRatingStats(
  _db: Database,
  repoIds: string[],
): Promise<Map<string, PackageRatingStats>> {
  const map = new Map<string, PackageRatingStats>();
  for (const repoId of repoIds) {
    map.set(repoId, {
      rating_avg: null,
      rating_count: 0,
    });
  }

  return map;
}

export async function getPackageRatingSummary(
  _db: Database,
  _repoId: string,
): Promise<PackageRatingStats> {
  return {
    rating_avg: null,
    rating_count: 0,
  };
}

export async function fetchPublishStatuses(
  db: Database,
  targets: PublishStatusTarget[],
): Promise<Map<string, PublishStatus>> {
  const map = new Map<string, PublishStatus>();
  if (targets.length === 0) {
    return map;
  }

  const repoIds = Array.from(new Set(targets.map((target) => target.repoId)));
  const tags = Array.from(new Set(targets.map((target) => target.releaseTag)));
  const assetIds = Array.from(new Set(targets.map((target) => target.assetId)));
  if (repoIds.length === 0 || tags.length === 0 || assetIds.length === 0) {
    return map;
  }

  const releaseRows = await db.select({
    id: repoReleases.id,
    repoId: repoReleases.repoId,
    tag: repoReleases.tag,
  })
    .from(repoReleases)
    .where(and(
      inArray(repoReleases.repoId, repoIds),
      inArray(repoReleases.tag, tags),
    ))
    .all();

  const releaseIdByRepoTag = new Map<string, string>();
  for (const release of releaseRows) {
    releaseIdByRepoTag.set(`${release.repoId}:${release.tag}`, release.id);
  }

  const deploymentRows = await db.select({
    sourceRepoId: bundleDeployments.sourceRepoId,
    sourceTag: bundleDeployments.sourceTag,
    sourceAssetId: bundleDeployments.sourceAssetId,
    rolloutState: bundleDeployments.rolloutState,
    deployedAt: bundleDeployments.deployedAt,
  })
    .from(bundleDeployments)
    .where(and(
      eq(bundleDeployments.sourceType, "git"),
      inArray(bundleDeployments.sourceRepoId, repoIds),
      inArray(bundleDeployments.sourceAssetId, assetIds),
    ))
    .orderBy(desc(bundleDeployments.deployedAt))
    .all();

  for (const deployment of deploymentRows) {
    if (
      !deployment.sourceRepoId || !deployment.sourceTag ||
      !deployment.sourceAssetId
    ) {
      continue;
    }

    const releaseId = releaseIdByRepoTag.get(
      `${deployment.sourceRepoId}:${deployment.sourceTag}`,
    );
    if (!releaseId) {
      continue;
    }

    const key = `${releaseId}:${deployment.sourceAssetId}`;
    if (map.has(key)) {
      continue;
    }

    map.set(
      key,
      parsePublishStatusFromRolloutState(deployment.rolloutState ?? null),
    );
  }

  return map;
}
