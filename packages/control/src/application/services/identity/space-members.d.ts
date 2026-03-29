import type { D1Database } from '../../../shared/types/bindings.ts';
import type { User, SpaceMembership, SpaceRole } from '../../../shared/types';
interface MemberListItem {
    username: string;
    email: string;
    name: string;
    picture: string | null;
    role: string;
    created_at: string;
}
export declare function listSpaceMembers(db: D1Database, spaceId: string): Promise<MemberListItem[]>;
export declare function getUserByEmail(db: D1Database, email: string): Promise<User | null>;
export declare function getSpaceMember(db: D1Database, spaceId: string, actorId: string): Promise<SpaceMembership | null>;
export declare function createSpaceMember(db: D1Database, spaceId: string, actorId: string, role: SpaceRole): Promise<{
    role: SpaceRole;
    created_at: string;
}>;
export declare function updateSpaceMemberRole(db: D1Database, spaceId: string, actorId: string, role: SpaceRole): Promise<void>;
export declare function deleteSpaceMember(db: D1Database, spaceId: string, actorId: string): Promise<void>;
export {};
//# sourceMappingURL=space-members.d.ts.map