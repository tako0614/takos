import type {
  SpaceRole,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";

type MembershipRow = {
  role: string;
};

type AccountRow = {
  id: string;
};

export async function readSpaceMembershipRole(
  db: SqlDatabaseBinding,
  spaceId: string,
  actorAccountId: string,
  requiredRoles?: SpaceRole[],
): Promise<SpaceRole | null> {
  const actor = await db.prepare(`
    SELECT id
    FROM accounts
    WHERE id = ?
    LIMIT 1
  `).bind(actorAccountId).first<AccountRow>();
  if (!actor) return null;

  const membership = await db.prepare(`
    SELECT role
    FROM account_memberships
    WHERE account_id = ? AND member_id = ?
    LIMIT 1
  `).bind(spaceId, actor.id).first<MembershipRow>();
  if (!membership || !isSpaceRole(membership.role)) return null;
  if (requiredRoles && !requiredRoles.includes(membership.role)) return null;

  return membership.role;
}

function isSpaceRole(value: string): value is SpaceRole {
  return value === "owner" ||
    value === "admin" ||
    value === "editor" ||
    value === "viewer";
}
