import type { D1Database } from "../../../shared/types/bindings.ts";
import {
  accounts,
  commits,
  getDb as realGetDb,
  pullRequests,
  repoReleases,
  repositories,
  serviceDeployments,
} from "../../../infra/db/index.ts";
import { and, desc, eq, lt } from "drizzle-orm";
import { listServiceRouteRecordsByIds as realListServiceRouteRecordsByIds } from "../platform/workers.ts";

export const profileActivityDeps = {
  getDb: realGetDb,
  listServiceRouteRecordsByIds: realListServiceRouteRecordsByIds,
};

function resolveRepoOwnerUsername(account: {
  id: string;
  slug: string | null;
}): string | null {
  return account.slug || account.id;
}

export type ActivityEventType =
  | "commit"
  | "release"
  | "pull_request"
  | "deployment";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  created_at: string;
  title: string;
  repo?: {
    owner_username: string;
    name: string;
  } | null;
  data?: Record<string, unknown>;
}

export interface FetchActivityParams {
  profileUserId: string;
  profileUserEmail: string;
  limit: number;
  before: string | null;
}

export interface FetchActivityResult {
  events: ActivityEvent[];
  has_more: boolean;
}

/**
 * Fetches and merges activity events (commits, releases, PRs, deployments)
 * for the given user, sorted by date descending.
 */
export async function fetchProfileActivity(
  dbBinding: D1Database,
  params: FetchActivityParams,
): Promise<FetchActivityResult> {
  const db = profileActivityDeps.getDb(dbBinding);
  const { profileUserId, profileUserEmail, limit, before } = params;

  const perType = limit + 1;

  // Build commit conditions
  const commitConditions = [
    eq(commits.authorEmail, profileUserEmail),
    eq(repositories.visibility, "public"),
  ];
  if (before) {
    commitConditions.push(lt(commits.commitDate, before));
  }

  // Build release conditions
  const releaseConditions = [
    eq(repoReleases.authorAccountId, profileUserId),
    eq(repositories.visibility, "public"),
  ];
  if (before) {
    releaseConditions.push(lt(repoReleases.createdAt, before));
  }

  // Build PR conditions
  const prConditions = [
    eq(pullRequests.authorType, "user"),
    eq(pullRequests.authorId, profileUserId),
    eq(repositories.visibility, "public"),
  ];
  if (before) {
    prConditions.push(lt(pullRequests.createdAt, before));
  }

  // Build deployment conditions
  const deploymentConditions = [
    eq(serviceDeployments.deployedBy, profileUserId),
  ];
  if (before) {
    deploymentConditions.push(lt(serviceDeployments.createdAt, before));
  }

  const commitRows = await db.select({
    id: commits.id,
    sha: commits.sha,
    message: commits.message,
    commitDate: commits.commitDate,
    repoName: repositories.name,
    accountId: accounts.id,
    accountSlug: accounts.slug,
  })
    .from(commits)
    .innerJoin(repositories, eq(commits.repoId, repositories.id))
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(...commitConditions))
    .orderBy(desc(commits.commitDate))
    .limit(perType)
    .all();

  const releaseRows = await db.select({
    id: repoReleases.id,
    tag: repoReleases.tag,
    name: repoReleases.name,
    publishedAt: repoReleases.publishedAt,
    createdAt: repoReleases.createdAt,
    repoName: repositories.name,
    accountId: accounts.id,
    accountSlug: accounts.slug,
  })
    .from(repoReleases)
    .innerJoin(repositories, eq(repoReleases.repoId, repositories.id))
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(...releaseConditions))
    .orderBy(desc(repoReleases.createdAt))
    .limit(perType)
    .all();

  const prRows = await db.select({
    id: pullRequests.id,
    number: pullRequests.number,
    title: pullRequests.title,
    status: pullRequests.status,
    createdAt: pullRequests.createdAt,
    repoName: repositories.name,
    accountId: accounts.id,
    accountSlug: accounts.slug,
  })
    .from(pullRequests)
    .innerJoin(repositories, eq(pullRequests.repoId, repositories.id))
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(...prConditions))
    .orderBy(desc(pullRequests.createdAt))
    .limit(perType)
    .all();

  const deploymentRows = await db.select({
    id: serviceDeployments.id,
    status: serviceDeployments.status,
    version: serviceDeployments.version,
    completedAt: serviceDeployments.completedAt,
    createdAt: serviceDeployments.createdAt,
    serviceId: serviceDeployments.serviceId,
  })
    .from(serviceDeployments)
    .where(and(...deploymentConditions))
    .orderBy(desc(serviceDeployments.createdAt))
    .limit(perType)
    .all();

  const serviceRouteMap = new Map(
    (await profileActivityDeps.listServiceRouteRecordsByIds(
      dbBinding,
      [...new Set(deploymentRows.map((row) => row.serviceId).filter(Boolean))],
    )).map((service) => [service.id, service]),
  );

  const events: ActivityEvent[] = [];

  for (const row of commitRows) {
    const ownerUsername = resolveRepoOwnerUsername({
      id: row.accountId,
      slug: row.accountSlug,
    });
    if (!ownerUsername) continue;
    const title = row.message.split("\n")[0] || "Commit";
    events.push({
      id: row.id,
      type: "commit",
      created_at: row.commitDate ?? new Date(0).toISOString(),
      title,
      repo: {
        owner_username: ownerUsername,
        name: row.repoName,
      },
      data: { sha: row.sha },
    });
  }

  for (const row of releaseRows) {
    const ownerUsername = resolveRepoOwnerUsername({
      id: row.accountId,
      slug: row.accountSlug,
    });
    if (!ownerUsername) continue;
    events.push({
      id: row.id,
      type: "release",
      created_at: row.publishedAt || row.createdAt || new Date(0).toISOString(),
      title: `Released ${row.tag}`,
      repo: {
        owner_username: ownerUsername,
        name: row.repoName,
      },
      data: {
        tag: row.tag,
        name: row.name,
      },
    });
  }

  for (const row of prRows) {
    const ownerUsername = resolveRepoOwnerUsername({
      id: row.accountId,
      slug: row.accountSlug,
    });
    if (!ownerUsername) continue;
    events.push({
      id: row.id,
      type: "pull_request",
      created_at: row.createdAt ?? new Date(0).toISOString(),
      title: `PR #${row.number}: ${row.title}`,
      repo: {
        owner_username: ownerUsername,
        name: row.repoName,
      },
      data: {
        number: row.number,
        status: row.status,
      },
    });
  }

  for (const row of deploymentRows) {
    const service = serviceRouteMap.get(row.serviceId);
    if (!service?.hostname) {
      continue;
    }
    const label = service.hostname || service.slug || service.routeRef ||
      "Service";
    events.push({
      id: row.id,
      type: "deployment",
      created_at: row.completedAt || row.createdAt || new Date(0).toISOString(),
      title: `Deployed ${label}`,
      repo: null,
      data: {
        service_hostname: service.hostname,
        service_slug: service.slug,
        service_name: service.routeRef,
        status: row.status,
        version: row.version,
      },
    });
  }

  events.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const hasMore = events.length > limit;
  const sliced = hasMore ? events.slice(0, limit) : events;

  return { events: sliced, has_more: hasMore };
}
