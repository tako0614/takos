import { and, desc, eq, or } from "drizzle-orm";
import {
  accountMemberships,
  accounts,
  repositories,
} from "../../../infra/db/index.ts";
import type { D1Database } from "../../../shared/types/bindings.ts";
import type { Env, Repository, Space } from "../../../shared/types/index.ts";
import {
  accountToWorkspace,
  type RepoSummary,
  spaceCrudDeps,
  type SpaceListItem,
  toRepository,
  toRepositoryFromSummary,
  toSpaceListItem,
} from "./space-crud-shared.ts";

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

async function loadLatestRepositoriesBySpace(
  db: D1Database,
  spaceIds: Iterable<string>,
): Promise<Map<string, RepoSummary | null>> {
  const latestRepoBySpace = new Map<string, RepoSummary | null>();

  for (const spaceId of spaceIds) {
    if (latestRepoBySpace.has(spaceId)) {
      continue;
    }
    latestRepoBySpace.set(
      spaceId,
      await findLatestRepositoryBySpaceId(db, spaceId),
    );
  }

  return latestRepoBySpace;
}

export async function loadSpaceById(db: D1Database, spaceId: string) {
  const drizzle = spaceCrudDeps.getDb(db);
  return drizzle
    .select()
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .limit(1)
    .get();
}

async function loadCanonicalSpaceByIdOrSlug(db: D1Database, idOrSlug: string) {
  const drizzle = spaceCrudDeps.getDb(db);
  return drizzle
    .select()
    .from(accounts)
    .where(or(eq(accounts.id, idOrSlug), eq(accounts.slug, idOrSlug)))
    .limit(1)
    .get();
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

export async function listWorkspacesForUser(
  env: Env,
  userId: string,
): Promise<SpaceListItem[]> {
  if (!spaceCrudDeps.isValidOpaqueId(userId)) {
    return [];
  }

  const principalId = await spaceCrudDeps.resolveUserPrincipalId(
    env.DB,
    userId,
  );
  if (!principalId) {
    return [];
  }

  const drizzle = spaceCrudDeps.getDb(env.DB);

  const memberships = await drizzle
    .select({
      memberRole: accountMemberships.role,
      spaceId: accounts.id,
      spaceType: accounts.type,
      spaceName: accounts.name,
      spaceSlug: accounts.slug,
      spaceOwnerAccountId: accounts.ownerAccountId,
      spaceHeadSnapshotId: accounts.headSnapshotId,
      spaceSecurityPosture: accounts.securityPosture,
      spaceCreatedAt: accounts.createdAt,
      spaceUpdatedAt: accounts.updatedAt,
    })
    .from(accountMemberships)
    .innerJoin(accounts, eq(accounts.id, accountMemberships.accountId))
    .where(eq(accountMemberships.memberId, principalId))
    .orderBy(desc(accounts.updatedAt))
    .all();

  if (memberships.length === 0) {
    return [];
  }

  const latestRepoBySpace = await loadLatestRepositoriesBySpace(
    env.DB,
    memberships.map((membership) => membership.spaceId),
  );

  return memberships.map((membership) =>
    toSpaceListItem(
      membership,
      latestRepoBySpace.get(membership.spaceId) ?? null,
    )
  );
}

export async function getWorkspaceWithRepository(
  env: Env,
  workspace: Space,
): Promise<{ workspace: Space; repository: Repository | null }> {
  return {
    workspace,
    repository: toRepositoryFromSummary(
      workspace,
      await findLatestRepositoryBySpaceId(env.DB, workspace.id),
    ),
  };
}

export async function getWorkspaceByIdOrSlug(
  db: D1Database,
  idOrSlug: string,
): Promise<Space | null> {
  const row = await loadCanonicalSpaceByIdOrSlug(db, idOrSlug);
  return row ? accountToWorkspace(row) : null;
}
