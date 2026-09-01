import type { Space } from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import { resolveUserPrincipalId } from "./principals.ts";
import { getDb, type SqlDatabaseLike } from "../../../infra/db/index.ts";
import { accountMemberships, accounts } from "../../../infra/db/schema.ts";
import { and, eq, or } from "drizzle-orm";

function toSpace(row: SelectOf<typeof accounts>): Space {
  const kind = row.type === "user"
    ? "user"
    : row.type === "system"
    ? "system"
    : "team";
  return {
    id: row.id,
    kind: kind as "user" | "team" | "system",
    name: row.name,
    slug: row.slug,
    description: row.description,
    principal_id: row.id,
    owner_user_id: row.type === "user"
      ? row.id
      : (row.ownerAccountId ?? row.id),
    owner_principal_id: row.type === "user"
      ? row.id
      : (row.ownerAccountId ?? row.id),
    automation_principal_id: null,
    head_snapshot_id: row.headSnapshotId,
    ai_model: row.aiModel,
    model_backend: row.modelBackend,
    security_posture: row.securityPosture === "restricted_egress"
      ? "restricted_egress"
      : "standard",
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function loadSpace(
  db: SqlDatabaseLike,
  spaceIdOrSlug: string,
  userId: string,
): Promise<Space | null> {
  const drizzle = getDb(db);

  if (spaceIdOrSlug === "me") {
    const row = await drizzle.select().from(accounts)
      .where(
        and(
          eq(accounts.id, userId),
          eq(accounts.type, "user"),
          eq(accounts.status, "active"),
        ),
      )
      .limit(1)
      .get();
    return row ? toSpace(row) : null;
  }

  const row = await drizzle.select().from(accounts)
    .where(
      and(
        eq(accounts.status, "active"),
        or(
          eq(accounts.id, spaceIdOrSlug),
          eq(accounts.slug, spaceIdOrSlug),
        ),
      ),
    )
    .limit(1)
    .get();

  return row ? toSpace(row) : null;
}

async function hasActiveOwnerMembership(
  db: SqlDatabaseLike,
  spaceId: string,
  principalId: string,
): Promise<boolean> {
  const drizzle = getDb(db);
  const row = await drizzle.select({ role: accountMemberships.role })
    .from(accountMemberships)
    .where(
      and(
        eq(accountMemberships.accountId, spaceId),
        eq(accountMemberships.memberId, principalId),
        eq(accountMemberships.status, "active"),
      ),
    )
    .limit(1)
    .get();

  return row?.role === "owner";
}

export interface SpaceAccess {
  space: Space;
}

export async function checkSpaceAccess(
  db: SqlDatabaseLike,
  spaceIdOrSlug: string,
  userId: string,
): Promise<SpaceAccess | null> {
  if (!isValidOpaqueId(userId)) {
    return null;
  }
  const principalId = await resolveUserPrincipalId(db, userId);
  if (!principalId) {
    return null;
  }

  const space = await loadSpace(db, spaceIdOrSlug, userId);
  if (!space) {
    return null;
  }

  const hasOwnerMembership = await hasActiveOwnerMembership(
    db,
    space.id,
    principalId,
  );
  // Takos Workspaces are personal tenancies. Historical membership rows can
  // remain during schema compatibility, but they must never grant product
  // access to a principal other than the Workspace owner.
  if (
    !hasOwnerMembership ||
    space.owner_principal_id !== principalId
  ) {
    return null;
  }

  return { space };
}
