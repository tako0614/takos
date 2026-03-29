import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SpaceRole, Space, SpaceMembership } from '../../../shared/types';
export declare function loadSpace(db: D1Database, spaceIdOrSlug: string, userId: string): Promise<Space | null>;
export declare function loadSpaceMembership(db: D1Database, spaceId: string, principalId: string): Promise<SpaceMembership | null>;
export interface SpaceAccess {
    space: Space;
    membership: SpaceMembership;
}
export declare function checkSpaceAccess(db: D1Database, spaceIdOrSlug: string, userId: string, requiredRoles?: SpaceRole[]): Promise<SpaceAccess | null>;
export declare function hasPermission(userRole: SpaceRole | null, requiredRole: 'owner' | 'admin' | 'editor' | 'viewer'): boolean;
//# sourceMappingURL=space-access.d.ts.map