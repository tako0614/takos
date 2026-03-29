/**
 * 3-way tree merge — path-level OID/mode comparison.
 *
 * Adapted from git-store/merge.ts for native git format.
 */
import type { R2Bucket } from '../../../../shared/types/bindings.ts';
import type { MergeConflict } from '../git-objects';
export declare function mergeTrees3Way(bucket: R2Bucket, baseTreeSha: string, localTreeSha: string, upstreamTreeSha: string): Promise<{
    tree_sha: string | null;
    conflicts: MergeConflict[];
}>;
//# sourceMappingURL=merge.d.ts.map