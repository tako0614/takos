import {
  accountMemberships,
  accounts,
  getDb,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import type { SpaceRole } from "../../../shared/types/index.ts";
import { resolveActorPrincipalId } from "../identity/principals.ts";
import { AuthorizationError } from "@takos/worker-platform-utils/errors";

export type StandardCapabilityId =
  | "storage.read"
  | "storage.write"
  | "repo.read"
  | "repo.write"
  | "egress.http"
  | "oauth.exchange"
  | "vectorize.write"
  | "queue.write"
  | "analytics.write"
  | "workflow.invoke"
  | "durable_object.use"
  | "billing.meter";

export type SecurityPosture = "standard" | "restricted_egress";
const WORKSPACE_ROLE_ORDER: SpaceRole[] = [
  "viewer",
  "editor",
  "admin",
  "owner",
];

export interface CapabilityPolicyContext {
  role: SpaceRole;
  securityPosture: SecurityPosture;
}

function normalizeSpaceRole(role: SpaceRole | null | undefined): SpaceRole {
  return role && WORKSPACE_ROLE_ORDER.includes(role) ? role : "viewer";
}

export function selectAllowedCapabilities(
  ctx: CapabilityPolicyContext,
): Set<StandardCapabilityId> {
  const allowed = new Set<StandardCapabilityId>(["repo.read", "storage.read"]);

  if (ctx.role === "owner" || ctx.role === "admin" || ctx.role === "editor") {
    allowed.add("repo.write");
    allowed.add("storage.write");
    allowed.add("egress.http");
    allowed.add("oauth.exchange");
    allowed.add("vectorize.write");
    allowed.add("queue.write");
    allowed.add("analytics.write");
    allowed.add("workflow.invoke");
    allowed.add("durable_object.use");
    allowed.add("billing.meter");
  }

  if (ctx.securityPosture === "restricted_egress" && ctx.role === "editor") {
    allowed.delete("egress.http");
  }

  return allowed;
}

export async function resolveSpaceRole(
  db: SqlDatabaseLike,
  spaceId: string,
  userId: string,
): Promise<SpaceRole | null> {
  const drizzle = getDb(db);
  const principalId = await resolveActorPrincipalId(db, userId);
  if (!principalId) {
    return null;
  }

  const workspace = await drizzle
    .select({
      ownerAccountId: accounts.ownerAccountId,
    })
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .get();

  if (workspace?.ownerAccountId === principalId) {
    return "owner";
  }

  const member = await drizzle
    .select({ role: accountMemberships.role })
    .from(accountMemberships)
    .where(
      and(
        eq(accountMemberships.accountId, spaceId),
        eq(accountMemberships.memberId, principalId),
        eq(accountMemberships.status, "active"),
      ),
    )
    .get();

  const role = (member?.role || "").toLowerCase();
  if (
    role === "owner" ||
    role === "admin" ||
    role === "editor" ||
    role === "viewer"
  ) {
    return role;
  }

  return null;
}

export async function resolveAllowedCapabilities(params: {
  db: SqlDatabaseLike;
  spaceId: string;
  userId: string;
  securityPosture?: SecurityPosture;
}): Promise<{
  ctx: CapabilityPolicyContext;
  allowed: Set<StandardCapabilityId>;
}> {
  const drizzle = getDb(params.db);
  const resolvedRole = await resolveSpaceRole(
    params.db,
    params.spaceId,
    params.userId,
  );
  if (!resolvedRole) {
    throw new AuthorizationError(
      `User ${params.userId} no longer has access to Workspace ${params.spaceId}`,
    );
  }
  const role = normalizeSpaceRole(resolvedRole);
  const workspace = await drizzle
    .select({
      securityPosture: accounts.securityPosture,
    })
    .from(accounts)
    .where(eq(accounts.id, params.spaceId))
    .get();
  const ctx: CapabilityPolicyContext = {
    role,
    securityPosture:
      params.securityPosture ??
      (workspace?.securityPosture === "restricted_egress"
        ? "restricted_egress"
        : "standard"),
  };

  return { ctx, allowed: selectAllowedCapabilities(ctx) };
}
