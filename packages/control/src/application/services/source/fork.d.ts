import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Repository } from '../../../shared/types';
export interface ForkOptions {
    name?: string;
    copyWorkflows?: boolean;
    copyConfig?: boolean;
}
export interface ForkResult {
    repository: Repository;
    forked_from: {
        id: string;
        name: string;
        space_id: string;
        is_official: boolean;
    };
    workflows_copied?: number;
}
export interface SyncStatus {
    can_sync: boolean;
    can_fast_forward: boolean;
    commits_behind: number;
    commits_ahead: number;
    has_conflicts: boolean;
    upstream: {
        id: string;
        name: string;
        space_id: string;
        default_branch: string;
    } | null;
    upstream_releases: UpstreamRelease[];
}
export interface UpstreamRelease {
    id: string;
    tag: string;
    name: string | null;
    published_at: string | null;
    is_newer: boolean;
}
export interface SyncOptions {
    strategy: 'merge' | 'rebase';
    target_ref?: string;
}
export interface SyncResult {
    success: boolean;
    commits_synced: number;
    new_head?: string;
    conflict?: boolean;
    message: string;
}
/**
 * Fork a repository with extended options
 * - Copies workflows if specified
 * - Generates .takos/config.yml template
 */
export declare function forkWithWorkflows(db: D1Database, bucket: R2Bucket | undefined, sourceRepoId: string, targetWorkspaceId: string, options?: ForkOptions): Promise<ForkResult>;
/**
 * Get sync status between a fork and its upstream
 */
export declare function getSyncStatus(db: D1Database, bucket: R2Bucket | undefined, repoId: string): Promise<SyncStatus>;
/**
 * Sync a fork with its upstream repository
 */
export declare function syncWithUpstream(db: D1Database, bucket: R2Bucket | undefined, repoId: string, options?: SyncOptions): Promise<SyncResult>;
//# sourceMappingURL=fork.d.ts.map