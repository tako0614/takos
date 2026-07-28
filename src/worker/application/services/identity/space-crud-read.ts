import { desc, eq, or } from "drizzle-orm";
import { accountMemberships, accounts } from "../../../infra/db/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import type { Env, Space } from "../../../shared/types/index.ts";
import {
  accountToWorkspace,
  spaceCrudDeps,
  type SpaceListItem,
  toSpaceListItem,
} from "./space-crud-shared.ts";

export async function loadSpaceById(db: SqlDatabaseBinding, spaceId: string) {
  const drizzle = spaceCrudDeps.getDb(db);
  return drizzle
    .select()
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .limit(1)
    .get();
}

async function loadCanonicalSpaceByIdOrSlug(
  db: SqlDatabaseBinding,
  idOrSlug: string,
) {
  const drizzle = spaceCrudDeps.getDb(db);
  return drizzle
    .select()
    .from(accounts)
    .where(or(eq(accounts.id, idOrSlug), eq(accounts.slug, idOrSlug)))
    .limit(1)
    .get();
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

  return memberships.map((membership) => toSpaceListItem(membership));
}

export async function getWorkspaceByIdOrSlug(
  db: SqlDatabaseBinding,
  idOrSlug: string,
): Promise<Space | null> {
  const row = await loadCanonicalSpaceByIdOrSlug(db, idOrSlug);
  return row ? accountToWorkspace(row) : null;
}
