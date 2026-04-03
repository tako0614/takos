import type { D1Database } from "../../../shared/types/bindings.ts";
import type { Repository } from "../../../shared/types/index.ts";
import { repositories } from "../../../infra/db/index.ts";
import { desc, eq, inArray } from "drizzle-orm";
import { spaceCrudDeps } from "./space-crud-deps.ts";
import { type RepoSummary, toRepository } from "./space-crud-models.ts";

export async function findLatestRepositoryBySpaceId(
  db: D1Database,
  spaceId: string,
): Promise<RepoSummary | null> {
  const drizzle = spaceCrudDeps.getDb(db);
  const repo = await drizzle
    .select({
      id: repositories.id,
      name: repositories.name,
      default_branch: repositories.defaultBranch,
    })
    .from(repositories)
    .where(eq(repositories.accountId, spaceId))
    .orderBy(desc(repositories.updatedAt))
    .limit(1)
    .get();
  return repo || null;
}

export async function loadLatestRepositoriesBySpace(
  db: D1Database,
  spaceIds: Iterable<string>,
): Promise<Map<string, RepoSummary | null>> {
  const uniqueSpaceIds = [...new Set(spaceIds)].filter(Boolean);
  const latestRepoBySpace = new Map<string, RepoSummary | null>();

  if (uniqueSpaceIds.length === 0) {
    return latestRepoBySpace;
  }

  if (uniqueSpaceIds.length === 1) {
    latestRepoBySpace.set(
      uniqueSpaceIds[0],
      await findLatestRepositoryBySpaceId(db, uniqueSpaceIds[0]),
    );
    return latestRepoBySpace;
  }

  const drizzle = spaceCrudDeps.getDb(db);
  const repos = await drizzle
    .select({
      id: repositories.id,
      space_id: repositories.accountId,
      name: repositories.name,
      default_branch: repositories.defaultBranch,
    })
    .from(repositories)
    .where(inArray(repositories.accountId, uniqueSpaceIds))
    .orderBy(desc(repositories.updatedAt))
    .all();

  for (const spaceId of uniqueSpaceIds) {
    latestRepoBySpace.set(spaceId, null);
  }

  for (const repo of repos) {
    if (!latestRepoBySpace.get(repo.space_id)) {
      latestRepoBySpace.set(repo.space_id, {
        id: repo.id,
        name: repo.name,
        default_branch: repo.default_branch,
      });
    }
  }

  return latestRepoBySpace;
}

export async function getRepositoryById(
  db: D1Database,
  repoId: string,
): Promise<Repository | null> {
  const drizzle = spaceCrudDeps.getDb(db);
  const repo = await drizzle
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1)
    .get();

  return repo ? toRepository(repo) : null;
}
