import type { D1Database } from '../../../shared/types/bindings.ts';
import type { AuthorType, PullRequestStatus, User } from '../../../shared/types';
import * as gitStore from '../git-smart';
type GitBucket = Parameters<typeof gitStore.getBlob>[0];
export interface Resolution {
    path: string;
    content: string;
    delete: boolean;
}
export interface MergeResolutionParams {
    db: D1Database;
    bucket: GitBucket;
    repoId: string;
    pullRequestId: string;
    baseBranch: string;
    headBranch: string;
    resolutions: Resolution[];
    commitMessage: string | undefined;
    user: User;
}
export type MergeResolutionSuccess = {
    success: true;
    pullRequest: {
        id: string;
        repoId: string;
        number: number;
        title: string;
        description: string | null;
        headBranch: string;
        baseBranch: string;
        status: PullRequestStatus;
        authorType: AuthorType;
        authorId: string | null;
        mergedAt: string | null;
        createdAt: string;
        updatedAt: string;
    };
    mergeCommit: string;
};
export type MergeResolutionFailure = {
    success: false;
    status: number;
    body: Record<string, unknown>;
};
export type MergeResolutionResult = MergeResolutionSuccess | MergeResolutionFailure;
/**
 * Resolve merge conflicts for a pull request by applying user-provided resolutions
 * and creating a merge commit.
 */
export declare function resolveConflictsAndMerge(params: MergeResolutionParams): Promise<MergeResolutionResult>;
export interface DetailedConflict {
    path: string;
    type: string;
    base: string | null;
    ours: string | null;
    theirs: string | null;
}
export interface ConflictCheckResult {
    conflicts: DetailedConflict[];
    merge_base: string | null;
    is_mergeable: boolean;
    base_sha?: string;
    head_sha?: string;
    message?: string;
}
/**
 * Check for merge conflicts between the base and head branches.
 */
export declare function checkConflicts(db: D1Database, bucket: GitBucket, repoId: string, baseBranchName: string, headBranchName: string): Promise<ConflictCheckResult>;
export declare class ConflictCheckError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export {};
//# sourceMappingURL=merge-resolution.d.ts.map