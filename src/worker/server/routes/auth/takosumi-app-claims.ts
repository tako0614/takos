export type TakosumiAppClaims = {
  readonly capsuleId: string;
  readonly appRole?: "owner" | "member";
  readonly workspaceId?: string;
};

const LEGACY_WORKSPACE_ROLES = new Set(["owner", "admin", "member", "viewer"]);

/** A configured app requires exact Capsule evidence; a foreign app never falls back. */
export function takosumiAppClaims(
  claims: Record<string, unknown>,
  expectedCapsuleId: string | undefined,
): TakosumiAppClaims | undefined {
  const expected = expectedCapsuleId?.trim();
  if (!expected) return undefined;
  const nested = claims.takosumi;
  if (nested === undefined) return undefined;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    throw new Error("OIDC UserInfo app claims are invalid");
  }
  const app = nested as Record<string, unknown>;
  if (!("capsule_id" in app) && !("app_role" in app)) return undefined;
  if (app.capsule_id !== expected) {
    throw new Error("OIDC UserInfo app binding mismatch");
  }
  if (
    app.app_role !== undefined &&
    app.app_role !== "owner" && app.app_role !== "member"
  ) {
    throw new Error("OIDC UserInfo app role is invalid");
  }

  // Current Accounts emits capsule_id + workspace_id + role, without app_role.
  // Keep that verified external selector for Interface discovery and control
  // APIs; never replace it with a local Takos workspace or infer it from a list.
  let workspaceId: string | undefined;
  const memberships = claims.workspace_memberships;
  const hasMemberships = memberships !== undefined &&
    !(Array.isArray(memberships) && memberships.length === 0);
  if (app.workspace_id !== undefined || hasMemberships) {
    workspaceId = takosumiWorkspaceId(claims);
  }
  if (
    app.role !== undefined &&
    (!workspaceId || typeof app.role !== "string" ||
      !LEGACY_WORKSPACE_ROLES.has(app.role))
  ) {
    throw new Error("OIDC UserInfo Workspace role is invalid");
  }
  const appRole = app.app_role ?? (workspaceId
    ? app.role === "owner" ? "owner" : "member"
    : undefined);
  return {
    capsuleId: expected,
    ...(appRole ? { appRole } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

/** The original browser sign-in Workspace binding, shared by legacy consumers. */
export function takosumiWorkspaceId(claims: Record<string, unknown>): string {
  const nested = claims.takosumi;
  const workspace = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined;
  const workspaceId = claimString(workspace?.workspace_id);
  const memberships = claims.workspace_memberships;
  if (
    !workspaceId || !Array.isArray(memberships) || memberships.length !== 1 ||
    claimString(memberships[0]) !== workspaceId
  ) {
    throw new Error("OIDC UserInfo Workspace binding mismatch");
  }
  return workspaceId;
}

function claimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
