/**
 * Space Role Constants.
 *
 * Centralized role definitions and hierarchy helpers.
 */

import type { SpaceRole } from "../types/models.ts";

/** Numeric hierarchy — higher value means broader permissions. */
export const ROLE_HIERARCHY: Record<SpaceRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

/** All space roles in descending privilege order. */
export const ALL_ROLES: SpaceRole[] = ["owner", "admin", "editor", "viewer"];

/** Roles that have administrative privileges. */
export const ADMIN_ROLES: SpaceRole[] = ["owner", "admin"];

/** Roles that can perform edit (write) operations. */
export const EDITOR_PLUS_ROLES: SpaceRole[] = ["owner", "admin", "editor"];

/**
 * Returns `true` when `role` is at least as privileged as `minimum`.
 */
export function hasMinimumRole(role: SpaceRole, minimum: SpaceRole): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimum];
}

/**
 * Returns `true` when the role has administrative privileges (`admin` or `owner`).
 */
export function isAdmin(role: SpaceRole): boolean {
  return hasMinimumRole(role, "admin");
}

/**
 * Returns `true` when the role can perform edit operations (`editor`, `admin`, or `owner`).
 */
export function canEdit(role: SpaceRole): boolean {
  return hasMinimumRole(role, "editor");
}
