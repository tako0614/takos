import type { User } from "../../../shared/types/index.ts";

// ---------------------------------------------------------------------------
// Workspace response formatter
// ---------------------------------------------------------------------------

export function toWorkspaceResponse(ws: {
  id?: string;
  kind?: string;
  name: string;
  slug: string | null;
  description?: string | null;
  owner_principal_id?: string;
  automation_principal_id?: string | null;
  head_snapshot_id?: string | null;
  security_posture?: "standard" | "restricted_egress";
  created_at: string;
  updated_at: string;
  member_role?: string;
}) {
  const slug = ws.slug || ws.id || "unknown";
  return {
    id: ws.id,
    slug,
    name: ws.name,
    description: ws.description ?? null,
    kind: ws.kind || "team",
    owner_principal_id: ws.owner_principal_id || null,
    automation_principal_id: ws.automation_principal_id ?? null,
    security_posture: ws.security_posture ?? "standard",
    created_at: ws.created_at,
    updated_at: ws.updated_at,
  };
}

// ---------------------------------------------------------------------------
// User response formatter
// ---------------------------------------------------------------------------

/**
 * Transform user for API response - excludes internal id field.
 * Frontend should use username to identify users.
 */
export function toUserResponse(user: User) {
  return {
    email: user.email,
    name: user.name,
    username: user.username,
    picture: user.picture,
    setup_completed: !!user.setup_completed,
  };
}
