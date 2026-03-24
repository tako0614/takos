/**
 * Workspace Role Constants.
 *
 * Centralized role definitions and hierarchy helpers.
 */

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** Numeric hierarchy — higher value means broader permissions. */
export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

/** All workspace roles in descending privilege order. */
export const ALL_ROLES: WorkspaceRole[] = ['owner', 'admin', 'editor', 'viewer'];

/** Roles that have administrative privileges. */
export const ADMIN_ROLES: WorkspaceRole[] = ['owner', 'admin'];

/** Roles that can perform edit (write) operations. */
export const EDITOR_PLUS_ROLES: WorkspaceRole[] = ['owner', 'admin', 'editor'];

/**
 * Returns `true` when `role` is at least as privileged as `minimum`.
 */
export function hasMinimumRole(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimum];
}

/**
 * Returns `true` when the role has administrative privileges (`admin` or `owner`).
 */
export function isAdmin(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, 'admin');
}

/**
 * Returns `true` when the role can perform edit operations (`editor`, `admin`, or `owner`).
 */
export function canEdit(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, 'editor');
}
