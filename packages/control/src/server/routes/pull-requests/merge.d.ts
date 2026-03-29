import type { User } from '../../../shared/types';
import { type Database } from '../../../infra/db';
import type { AuthenticatedRouteEnv } from '../route-auth';
import { type PullRequestRecord } from './dto';
export type MergeMethod = 'merge' | 'squash' | 'rebase';
type MergeExecutionFailure = {
    success: false;
    status: number;
    body: Record<string, unknown>;
};
type MergeExecutionSuccess = {
    success: true;
    pullRequest: PullRequestRecord;
    mergeCommit: string;
    headSha: string;
    baseShaForEvent: string;
    pushBefore: string | null;
};
export type MergeExecutionResult = MergeExecutionSuccess | MergeExecutionFailure;
export declare function jsonErrorWithStatus(body: Record<string, unknown>, status: number): Response;
export declare function validateConflictResolutionPath(path: unknown): string | null;
export declare function performPullRequestMerge(params: {
    env: AuthenticatedRouteEnv['Bindings'];
    db: Database;
    repoId: string;
    pullRequest: PullRequestRecord;
    mergeMethod: MergeMethod;
    commitMessage: string;
    user: User;
}): Promise<MergeExecutionResult>;
export {};
//# sourceMappingURL=merge.d.ts.map