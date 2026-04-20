import type { D1Database } from "../../../shared/types/bindings.ts";
import {
  accountMemberships,
  accounts,
  getDb,
} from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import type { SpaceRole } from "../../../shared/types/index.ts";
import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import { resolveActorPrincipalId } from "../identity/principals.ts";

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

export interface CapabilityDefinition {
  id: StandardCapabilityId;
  description: string;
}

export const STANDARD_CAPABILITIES: ReadonlyArray<CapabilityDefinition> = [
  { id: "storage.read", description: "R2 / files read access" },
  { id: "storage.write", description: "R2 / files write access" },
  { id: "repo.read", description: "Repository read access" },
  { id: "repo.write", description: "Repository write access" },
  {
    id: "egress.http",
    description: "Outbound HTTP requests to external origins",
  },
  { id: "oauth.exchange", description: "OAuth token exchange / refresh" },
  {
    id: "vectorize.write",
    description: "Vector DB write (embeddings / indexing)",
  },
  {
    id: "queue.write",
    description: "Queue resource binding and publishing access",
  },
  {
    id: "analytics.write",
    description: "Workers Analytics Engine dataset access",
  },
  {
    id: "workflow.invoke",
    description: "Takos-managed workflow invocation access",
  },
  {
    id: "durable_object.use",
    description: "Durable Object namespace binding access",
  },
  { id: "billing.meter", description: "Usage metering / billing record" },
] as const;

export class CapabilityRegistry {
  private defs = new Map<string, CapabilityDefinition>();

  constructor(
    defs: ReadonlyArray<CapabilityDefinition> = STANDARD_CAPABILITIES,
  ) {
    for (const def of defs) {
      this.register(def);
    }
  }

  register(def: CapabilityDefinition): void {
    this.defs.set(def.id, def);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  get(id: string): CapabilityDefinition | undefined {
    return this.defs.get(id);
  }

  validate(
    ids: readonly string[],
  ): {
    known: StandardCapabilityId[];
    unknown: string[];
    duplicates: string[];
  } {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    const unknown: string[] = [];
    const known: StandardCapabilityId[] = [];

    for (const raw of ids) {
      const id = String(raw || "").trim();
      if (!id) continue;
      if (seen.has(id)) {
        duplicates.push(id);
        continue;
      }
      seen.add(id);

      if (!this.has(id)) {
        unknown.push(id);
        continue;
      }
      known.push(id as StandardCapabilityId);
    }

    return { known, unknown, duplicates };
  }
}

export const capabilityRegistry = new CapabilityRegistry();

export type TenantType = "managed" | "approved" | "third_party";
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
  tenantType: TenantType;
}

function normalizeSpaceRole(role: SpaceRole | null | undefined): SpaceRole {
  return role && WORKSPACE_ROLE_ORDER.includes(role) ? role : "viewer";
}

function applySpaceRoleFloor(
  role: SpaceRole,
  minimumRole?: SpaceRole,
): SpaceRole {
  const normalizedRole = normalizeSpaceRole(role);
  if (!minimumRole) {
    return normalizedRole;
  }

  const normalizedFloor = normalizeSpaceRole(minimumRole);
  const currentIndex = WORKSPACE_ROLE_ORDER.indexOf(normalizedRole);
  const floorIndex = WORKSPACE_ROLE_ORDER.indexOf(normalizedFloor);
  return currentIndex >= floorIndex ? normalizedRole : normalizedFloor;
}

export function selectAllowedCapabilities(
  ctx: CapabilityPolicyContext,
): Set<StandardCapabilityId> {
  const allowed = new Set<StandardCapabilityId>([
    "repo.read",
    "storage.read",
  ]);

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
  db: D1Database,
  spaceId: string,
  userId: string,
): Promise<SpaceRole> {
  const drizzle = getDb(db);
  const principalId = await resolveActorPrincipalId(db, userId);
  if (!principalId) {
    return "viewer";
  }

  const workspace = await drizzle.select({
    ownerAccountId: accounts.ownerAccountId,
  }).from(accounts).where(eq(accounts.id, spaceId)).get();

  if (workspace?.ownerAccountId === principalId) {
    return "owner";
  }

  const member = await drizzle.select({ role: accountMemberships.role }).from(
    accountMemberships,
  ).where(
    and(
      eq(accountMemberships.accountId, spaceId),
      eq(accountMemberships.memberId, principalId),
    ),
  ).get();

  const role = (member?.role || "").toLowerCase();
  if (
    role === "owner" || role === "admin" || role === "editor" ||
    role === "viewer"
  ) {
    return role;
  }

  return "viewer";
}

export async function resolveAllowedCapabilities(params: {
  db: D1Database;
  spaceId: string;
  userId: string;
  securityPosture?: SecurityPosture;
  tenantType?: TenantType;
  minimumRole?: SpaceRole;
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
  const role = applySpaceRoleFloor(resolvedRole, params.minimumRole);
  const workspace = await drizzle.select({
    securityPosture: accounts.securityPosture,
  })
    .from(accounts)
    .where(eq(accounts.id, params.spaceId))
    .get();
  const ctx: CapabilityPolicyContext = {
    role,
    securityPosture: params.securityPosture ??
      (workspace?.securityPosture === "restricted_egress"
        ? "restricted_egress"
        : "standard"),
    tenantType: params.tenantType ?? "third_party",
  };

  return { ctx, allowed: selectAllowedCapabilities(ctx) };
}

export function requireCapability(
  allowed: Iterable<string>,
  required: StandardCapabilityId,
  message?: string,
): void {
  const set = allowed instanceof Set ? allowed : new Set(allowed);
  if (set.has(required)) return;
  throw new Error(
    message || `Permission denied: missing capability "${required}"`,
  );
}

export function filterBindingsByCapabilities(params: {
  bindings: WorkerBinding[];
  allowed: Set<StandardCapabilityId>;
}): { allowedBindings: WorkerBinding[]; deniedBindings: WorkerBinding[] } {
  const allowedBindings: WorkerBinding[] = [];
  const deniedBindings: WorkerBinding[] = [];

  for (const binding of params.bindings) {
    if (binding.type === "plain_text" || binding.type === "secret_text") {
      allowedBindings.push(binding);
      continue;
    }

    if (
      binding.type === "d1" ||
      binding.type === "kv_namespace" ||
      binding.type === "r2_bucket"
    ) {
      if (params.allowed.has("storage.write")) {
        allowedBindings.push(binding);
      } else {
        deniedBindings.push(binding);
      }
      continue;
    }

    if (binding.type === "queue") {
      if (
        params.allowed.has("queue.write") || params.allowed.has("storage.write")
      ) {
        allowedBindings.push(binding);
      } else {
        deniedBindings.push(binding);
      }
      continue;
    }

    if (binding.type === "analytics_engine") {
      if (
        params.allowed.has("analytics.write") ||
        params.allowed.has("storage.write")
      ) {
        allowedBindings.push(binding);
      } else {
        deniedBindings.push(binding);
      }
      continue;
    }

    if (binding.type === "vectorize") {
      if (params.allowed.has("vectorize.write")) {
        allowedBindings.push(binding);
      } else {
        deniedBindings.push(binding);
      }
      continue;
    }

    if (binding.type === "workflow") {
      if (params.allowed.has("workflow.invoke")) {
        allowedBindings.push(binding);
      } else {
        deniedBindings.push(binding);
      }
      continue;
    }

    if (binding.type === "durable_object_namespace") {
      if (params.allowed.has("durable_object.use")) {
        allowedBindings.push(binding);
      } else {
        deniedBindings.push(binding);
      }
      continue;
    }

    if (binding.type === "service") {
      allowedBindings.push(binding);
      continue;
    }

    deniedBindings.push(binding);
  }

  return { allowedBindings, deniedBindings };
}
