/**
 * Space Role Constants.
 *
 * Centralized role definitions and hierarchy helpers.
 */
import type { SpaceRole } from '../types/models.ts';
/** Numeric hierarchy — higher value means broader permissions. */
export declare const ROLE_HIERARCHY: Record<SpaceRole, number>;
/** All space roles in descending privilege order. */
export declare const ALL_ROLES: SpaceRole[];
/** Roles that have administrative privileges. */
export declare const ADMIN_ROLES: SpaceRole[];
/** Roles that can perform edit (write) operations. */
export declare const EDITOR_PLUS_ROLES: SpaceRole[];
/**
 * Returns `true` when `role` is at least as privileged as `minimum`.
 */
export declare function hasMinimumRole(role: SpaceRole, minimum: SpaceRole): boolean;
/**
 * Returns `true` when the role has administrative privileges (`admin` or `owner`).
 */
export declare function isAdmin(role: SpaceRole): boolean;
/**
 * Returns `true` when the role can perform edit operations (`editor`, `admin`, or `owner`).
 */
export declare function canEdit(role: SpaceRole): boolean;
//# sourceMappingURL=roles.d.ts.map