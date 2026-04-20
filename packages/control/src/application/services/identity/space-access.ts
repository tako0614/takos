import type { D1Database } from "../../../shared/types/bindings.ts";
import type {
  Space,
  SpaceMembership,
  SpaceRole,
} from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import { resolveUserPrincipalId } from "./principals.ts";
import { getDb } from "../../../infra/db/index.ts";
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

function toSpaceMembership(
  row: SelectOf<typeof accountMemberships>,
): SpaceMembership {
  return {
    id: row.id,
    space_id: row.accountId,
    principal_id: row.memberId,
    role: row.role as SpaceRole,
    created_at: row.createdAt,
  };
}

export async function loadSpace(
  db: D1Database,
  spaceIdOrSlug: string,
  userId: string,
): Promise<Space | null> {
  const drizzle = getDb(db);

  if (spaceIdOrSlug === "me") {
    const row = await drizzle.select().from(accounts)
      .where(and(eq(accounts.id, userId), eq(accounts.type, "user")))
      .limit(1)
      .get();
    return row ? toSpace(row) : null;
  }

  const row = await drizzle.select().from(accounts)
    .where(or(eq(accounts.id, spaceIdOrSlug), eq(accounts.slug, spaceIdOrSlug)))
    .limit(1)
    .get();

  return row ? toSpace(row) : null;
}

export async function loadSpaceMembership(
  db: D1Database,
  spaceId: string,
  principalId: string,
): Promise<SpaceMembership | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(accountMemberships)
    .where(
      and(
        eq(accountMemberships.accountId, spaceId),
        eq(accountMemberships.memberId, principalId),
      ),
    )
    .limit(1)
    .get();

  return row ? toSpaceMembership(row) : null;
}

export interface SpaceAccess {
  space: Space;
  membership: SpaceMembership;
}

export async function checkSpaceAccess(
  db: D1Database,
  spaceIdOrSlug: string,
  userId: string,
  requiredRoles?: SpaceRole[],
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

  const membership = await loadSpaceMembership(db, space.id, principalId);
  if (!membership) {
    return null;
  }

  if (requiredRoles && !requiredRoles.includes(membership.role)) {
    return null;
  }

  return { space, membership };
}

export function hasPermission(
  userRole: SpaceRole | null,
  requiredRole: "owner" | "admin" | "editor" | "viewer",
): boolean {
  if (!userRole) return false;

  const roleLevel: Record<SpaceRole, number> = {
    owner: 4,
    admin: 3,
    editor: 2,
    viewer: 1,
  };

  return roleLevel[userRole] >= roleLevel[requiredRole];
}
