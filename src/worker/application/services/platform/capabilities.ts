import type { SqlDatabaseLike } from "../../../infra/db/index.ts";
import { createSqlWorkspacePersistence } from "../../../adapters/workspaces/index.ts";
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

export interface CapabilityPolicyContext {
  /**
   * Historical tool-catalog tier only. Workspace authority was already proven
   * and production never derives this value from a membership row.
   */
  toolPolicyTier: "owner";
  securityPosture: SecurityPosture;
}

export function selectAllowedCapabilities(
  _ctx: CapabilityPolicyContext,
): Set<StandardCapabilityId> {
  return new Set<StandardCapabilityId>([
    "repo.read",
    "repo.write",
    "storage.read",
    "storage.write",
    "egress.http",
    "oauth.exchange",
    "vectorize.write",
    "queue.write",
    "analytics.write",
    "workflow.invoke",
    "durable_object.use",
    "billing.meter",
  ]);
}

async function resolveOwnedWorkspace(
  db: SqlDatabaseLike,
  workspaceId: string,
  userId: string,
) {
  const principalId = await resolveActorPrincipalId(db, userId);
  if (!principalId) return null;
  return await createSqlWorkspacePersistence(db).resolveForPrincipal(
    principalId,
    workspaceId,
  );
}

export async function resolveWorkspaceAuthority(
  db: SqlDatabaseLike,
  workspaceId: string,
  userId: string,
): Promise<"owner" | null> {
  return (await resolveOwnedWorkspace(db, workspaceId, userId))
    ? "owner"
    : null;
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
  const workspace = await resolveOwnedWorkspace(
    params.db,
    params.spaceId,
    params.userId,
  );
  if (!workspace) {
    throw new AuthorizationError(
      `User ${params.userId} no longer has access to Workspace ${params.spaceId}`,
    );
  }
  const ctx: CapabilityPolicyContext = {
    toolPolicyTier: "owner",
    securityPosture:
      params.securityPosture ??
      (workspace.securityPosture === "restricted_egress"
        ? "restricted_egress"
        : "standard"),
  };

  return { ctx, allowed: selectAllowedCapabilities(ctx) };
}
