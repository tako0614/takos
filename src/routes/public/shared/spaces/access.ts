import type { Context } from "hono";
import type {
  SpaceRole,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";
import type { TakosumiActorContext } from "takosumi-contract-v2/internal/rpc";
import { requireDbAndActor } from "../api/auth.ts";
import type { ApiBindings } from "../api/bindings.ts";
import { commonError } from "../api/common.ts";

type MembershipRow = {
  role: string;
};

type AccountRow = {
  id: string;
};

export type SpaceMembershipGuardResult =
  | { ok: true; actor: TakosumiActorContext; spaceId: string }
  | { ok: false; response: Response };

/**
 * Authenticate the caller and verify they hold at least viewer-level membership
 * in `spaceId`. This is the canonical tenant-membership (IDOR) gate shared by
 * the runtime-gateway and repositories public routes — without it any
 * authenticated account could read or mutate runtime/Git state in spaces they
 * don't belong to. Resolves the actor via {@link requireDbAndActor} (which also
 * guards the DB binding and seeds the correlation id) before reading the
 * membership role, so the signed actor context is known-good before any
 * downstream RPC fires.
 */
export async function requireSpaceMembership(
  c: Context<{ Bindings: ApiBindings }>,
  spaceId: string,
): Promise<SpaceMembershipGuardResult> {
  const resolved = await requireDbAndActor(c, spaceId);
  if (!resolved.ok) return { ok: false, response: resolved.response };
  const role = await readSpaceMembershipRole(
    resolved.db,
    spaceId,
    resolved.actor.actorAccountId,
  );
  if (!role) {
    return {
      ok: false,
      response: c.json(commonError("FORBIDDEN", "forbidden"), 403),
    };
  }
  return { ok: true, actor: resolved.actor, spaceId };
}

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
