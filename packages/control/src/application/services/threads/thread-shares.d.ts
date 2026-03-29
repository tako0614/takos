import type { D1Database } from '../../../shared/types/bindings.ts';
export type ThreadShareMode = 'public' | 'password';
export type ThreadShareRecord = {
    id: string;
    thread_id: string;
    space_id: string;
    created_by: string | null;
    token: string;
    mode: ThreadShareMode;
    expires_at: string | null;
    revoked_at: string | null;
    last_accessed_at: string | null;
    created_at: string;
};
export declare function generateThreadShareToken(): string;
export declare function createThreadShare(params: {
    db: D1Database;
    threadId: string;
    spaceId: string;
    createdBy: string;
    mode: ThreadShareMode;
    password?: string | null;
    expiresAt?: string | null;
}): Promise<{
    share: ThreadShareRecord;
    passwordRequired: boolean;
}>;
export declare function listThreadShares(d1: D1Database, threadId: string): Promise<ThreadShareRecord[]>;
export declare function revokeThreadShare(params: {
    db: D1Database;
    threadId: string;
    shareId: string;
}): Promise<boolean>;
export declare function getThreadShareByToken(d1: D1Database, token: string): Promise<(ThreadShareRecord & {
    password_hash: string | null;
}) | null>;
export declare function markThreadShareAccessed(d1: D1Database, shareId: string): Promise<void>;
export declare function verifyThreadShareAccess(params: {
    db: D1Database;
    token: string;
    password?: string | null;
}): Promise<{
    share: ThreadShareRecord;
    threadId: string;
    spaceId: string;
} | {
    error: 'not_found' | 'password_required' | 'forbidden';
}>;
//# sourceMappingURL=thread-shares.d.ts.map