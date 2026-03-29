/**
 * Commit creation, D1 indexing, and DAG traversal.
 *
 * Adapted from git-store/commit.ts with native git object format.
 */
import type { D1Database, R2Bucket } from '../../../../shared/types/bindings.ts';
import type { GitCommit, CreateCommitParams } from '../git-objects';
export declare function createCommit(dbBinding: D1Database, bucket: R2Bucket, repoId: string, params: CreateCommitParams): Promise<GitCommit>;
/**
 * Index an existing commit (received via push) into D1.
 */
export declare function indexCommit(dbBinding: D1Database, repoId: string, commit: GitCommit): Promise<void>;
export declare function getCommitFromIndex(dbBinding: D1Database, repoId: string, sha: string): Promise<GitCommit | null>;
export declare function getCommit(dbBinding: D1Database, bucket: R2Bucket, repoId: string, sha: string): Promise<GitCommit | null>;
export declare function getCommitLog(dbBinding: D1Database, bucket: R2Bucket, repoId: string, startSha: string, limit?: number): Promise<GitCommit[]>;
export declare function getCommitsFromRef(dbBinding: D1Database, bucket: R2Bucket, repoId: string, startSha: string, limit?: number): Promise<GitCommit[]>;
export declare function isAncestor(dbBinding: D1Database, bucket: R2Bucket, repoId: string, ancestorSha: string, descendantSha: string): Promise<boolean>;
export declare function findMergeBase(dbBinding: D1Database, bucket: R2Bucket, repoId: string, sha1: string, sha2: string): Promise<string | null>;
export declare function countCommitsBetween(dbBinding: D1Database, bucket: R2Bucket, repoId: string, baseSha: string, headSha: string): Promise<{
    ahead: number;
    behind: number;
    has_merge_base: boolean;
}>;
/**
 * Collect all object SHAs reachable from want set, stopping at have set.
 * Used for upload-pack negotiation.
 */
export declare function collectReachableObjects(dbBinding: D1Database, bucket: R2Bucket, repoId: string, wants: string[], haves: Set<string>): Promise<string[]>;
/**
 * Collect all object SHAs reachable from all refs in a repository.
 * Used for GC / cleanup (determining which objects are still live).
 */
export declare function collectReachableObjectShas(dbBinding: D1Database, bucket: R2Bucket, repoId: string): Promise<Set<string>>;
//# sourceMappingURL=commit-index.d.ts.map