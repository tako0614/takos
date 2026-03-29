import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Database } from '../../../infra/db';
import type { Env } from '../../../shared/types';
import type { FollowUserResponse } from './dto';
export declare function getBlockFlags(db: Database, currentUserId: string | undefined, targetUserId: string): Promise<{
    blocked_by_target: boolean;
    is_blocking: boolean;
}>;
export declare function fetchFollowList(_db: D1Database, db: Database, profileUserId: string, currentUserId: string | undefined, mode: 'followers' | 'following', options: {
    limit: number;
    offset: number;
    sort: string;
    order: string;
}): Promise<{
    users: FollowUserResponse[];
    total: number;
    has_more: boolean;
}>;
export declare function sendFollowNotificationIfNotMuted(env: Env, d1: D1Database, targetUserId: string, actor: {
    id: string;
    username: string;
    name: string;
    picture: string | null;
}, type: 'social.follow.requested' | 'social.followed'): Promise<void>;
export declare function isMutedByViewer(db: Database, currentUserId: string | undefined, targetUserId: string): Promise<boolean>;
export declare function hasPendingFollowRequest(db: Database, requesterId: string | undefined, targetId: string): Promise<boolean>;
//# sourceMappingURL=block-follow-utils.d.ts.map