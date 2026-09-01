import type { SqlDatabaseLike } from "../../../infra/db/index.ts";
import { AuthorizationError } from "@takos/worker-platform-utils/errors";
import { checkSpaceAccess } from "../identity/space-access.ts";

export const STANDARD_CAPABILITY_IDS = [
  "storage.read",
  "storage.write",
  "repo.read",
  "repo.write",
  "egress.http",
  "oauth.exchange",
  "vectorize.write",
  "queue.write",
  "analytics.write",
  "workflow.invoke",
  "durable_object.use",
  "billing.meter",
] as const;

export type StandardCapabilityId = typeof STANDARD_CAPABILITY_IDS[number];

export type SecurityPosture = "standard" | "restricted_egress";

export interface CapabilityPolicyContext {
  securityPosture: SecurityPosture;
}

export function selectAllowedCapabilities(
  ctx: CapabilityPolicyContext,
): Set<StandardCapabilityId> {
  const allowed = new Set<StandardCapabilityId>(STANDARD_CAPABILITY_IDS);

  // Security posture belongs to the private Workspace, not to a historical
  // collaboration role. A restricted owner must not regain outbound network
  // authority merely because every current Takos caller is the owner.
  if (ctx.securityPosture === "restricted_egress") {
    allowed.delete("egress.http");
  }

  return allowed;
}

export async function resolveAllowedCapabilities(params: {
  db: SqlDatabaseLike;
  spaceId: string;
  userId: string;
}): Promise<{
  ctx: CapabilityPolicyContext;
  allowed: Set<StandardCapabilityId>;
}> {
  const access = await checkSpaceAccess(
    params.db,
    params.spaceId,
    params.userId,
  );
  if (!access) {
    throw new AuthorizationError(
      `User ${params.userId} no longer has access to Workspace ${params.spaceId}`,
    );
  }
  const ctx: CapabilityPolicyContext = {
    securityPosture: access.space.security_posture === "restricted_egress"
      ? "restricted_egress"
      : "standard",
  };

  return { ctx, allowed: selectAllowedCapabilities(ctx) };
}
