import type { User } from "../../../shared/types/index.ts";

// ---------------------------------------------------------------------------
// Workspace response formatter
// ---------------------------------------------------------------------------

export function toWorkspaceResponse(ws: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  security_posture: "standard" | "restricted_egress";
  created_at: string;
  updated_at: string;
}) {
  return {
    id: ws.id,
    slug: ws.slug,
    name: ws.name,
    description: ws.description,
    is_default: ws.is_default,
    security_posture: ws.security_posture,
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
