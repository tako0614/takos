import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Repository, Space } from '../../../shared/types';
export interface ProfileUser {
    id: string;
    email: string;
    name: string;
    picture: string | null;
    username: string;
    bio: string | null;
    created_at: string;
    updated_at: string;
}
export declare function getUserByUsername(dbBinding: D1Database, username: string): Promise<ProfileUser | null>;
export declare function getUserStats(dbBinding: D1Database, userId: string): Promise<{
    public_repo_count: number;
    followers_count: number;
    following_count: number;
}>;
export declare function isFollowing(dbBinding: D1Database, currentUserId: string | undefined, targetUserId: string): Promise<boolean>;
export type ActivityVisibility = 'public' | 'followers' | 'private';
export declare function getUserPrivacySettings(dbBinding: D1Database, userId: string): Promise<{
    private_account: boolean;
    activity_visibility: ActivityVisibility;
}>;
export declare function isMutedBy(dbBinding: D1Database, muterId: string, mutedId: string): Promise<boolean>;
export declare function batchStarCheck(dbBinding: D1Database, currentUserId: string | undefined, repoIds: string[]): Promise<Set<string>>;
export declare function findRepoByUsernameAndName(dbBinding: D1Database, username: string, repoName: string, currentUserId?: string): Promise<{
    repo: Repository;
    workspace: Space;
    owner: ProfileUser;
} | null>;
//# sourceMappingURL=profile-queries.d.ts.map