/**
 * Degradation-tolerant commit resolution.
 *
 * Adapted from git-store/readable-commit.ts.
 */
import type { D1Database, R2Bucket } from '../../../../shared/types/bindings.ts';
import type { GitCommit } from '../git-objects';
export type ResolveReadableCommitFailureReason = 'ref_not_found' | 'commit_not_found' | 'tree_not_found';
export type ResolveReadableCommitResult = {
    ok: true;
    refCommitSha: string;
    resolvedCommitSha: string;
    degraded: boolean;
    commit: GitCommit;
} | {
    ok: false;
    reason: ResolveReadableCommitFailureReason;
    refCommitSha?: string;
};
export declare function resolveReadableCommitFromRef(db: D1Database, bucket: R2Bucket, repoId: string, ref: string, options?: {
    fallbackLimit?: number;
}): Promise<ResolveReadableCommitResult>;
//# sourceMappingURL=readable-commit.d.ts.map