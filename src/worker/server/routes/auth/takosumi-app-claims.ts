export type TakosumiAppClaims = {
  readonly capsuleId: string;
  readonly appRole?: "owner" | "member";
};

/** App evidence is authoritative when present; a foreign app never falls back. */
export function takosumiAppClaims(
  claims: Record<string, unknown>,
  expectedCapsuleId: string | undefined,
): TakosumiAppClaims | undefined {
  const nested = claims.takosumi;
  if (nested === undefined) return undefined;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    throw new Error("OIDC UserInfo app claims are invalid");
  }
  const app = nested as Record<string, unknown>;
  if (!("capsule_id" in app) && !("app_role" in app)) return undefined;
  const expected = expectedCapsuleId?.trim();
  if (!expected || app.capsule_id !== expected) {
    throw new Error("OIDC UserInfo app binding mismatch");
  }
  if (
    app.app_role !== undefined &&
    app.app_role !== "owner" && app.app_role !== "member"
  ) {
    throw new Error("OIDC UserInfo app role is invalid");
  }
  return {
    capsuleId: expected,
    ...(app.app_role ? { appRole: app.app_role } : {}),
  };
}
