/**
 * High-level git operations (init, fork, sync, commit).
 */
import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { GitCommit, GitSignature, GitBranch } from './git-objects';
export declare function initRepository(dbBinding: D1Database, bucket: R2Bucket, repoId: string, defaultBranch?: string, author?: GitSignature): Promise<{
    commit: GitCommit;
    branch: GitBranch;
}>;
export declare function forkRepository(dbBinding: D1Database, sourceRepoId: string, targetRepoId: string): Promise<void>;
export declare function checkSyncStatus(dbBinding: D1Database, bucket: R2Bucket, forkRepoId: string, branchName?: string): Promise<{
    can_sync: boolean;
    can_fast_forward: boolean;
    commits_behind: number;
    commits_ahead: number;
    has_merge_base: boolean;
    has_conflict: boolean;
    upstream_repo_id: string | null;
}>;
export declare function commitFile(dbBinding: D1Database, bucket: R2Bucket, repoId: string, path: string, content: string, message: string, options?: {
    branch?: string;
    author?: GitSignature;
}): Promise<GitCommit>;
//# sourceMappingURL=operations.d.ts.map