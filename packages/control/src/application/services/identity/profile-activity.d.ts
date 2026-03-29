import type { D1Database } from '../../../shared/types/bindings.ts';
export type ActivityEventType = 'commit' | 'release' | 'pull_request' | 'deployment';
export interface ActivityEvent {
    id: string;
    type: ActivityEventType;
    created_at: string;
    title: string;
    repo?: {
        owner_username: string;
        name: string;
    } | null;
    data?: Record<string, unknown>;
}
export interface FetchActivityParams {
    profileUserId: string;
    profileUserEmail: string;
    limit: number;
    before: string | null;
}
export interface FetchActivityResult {
    events: ActivityEvent[];
    has_more: boolean;
}
/**
 * Fetches and merges activity events (commits, releases, PRs, deployments)
 * for the given user, sorted by date descending.
 */
export declare function fetchProfileActivity(dbBinding: D1Database, params: FetchActivityParams): Promise<FetchActivityResult>;
//# sourceMappingURL=profile-activity.d.ts.map