/**
 * Packfile reader — parse incoming packfiles from git push.
 *
 * Reads packfile objects, inflates, and stores as loose objects in R2.
 * Supports undeltified objects (commit, tree, blob, tag) and delta objects.
 *
 * Uses fflate for synchronous zlib inflate, which reports consumed bytes
 * and eliminates the need for binary search to find zlib frame boundaries.
 */
import type { R2Bucket } from '../../../../shared/types/bindings.ts';
export interface PackfileReadLimits {
    maxObjectCount?: number;
    maxInflatedTotal?: number;
    maxObjectInflated?: number;
    maxDeltaResultInflated?: number;
    maxDeltaChainDepth?: number;
    maxPackfileBytes?: number;
}
/**
 * Apply a git delta instruction stream to a base object.
 */
declare function applyDelta(base: Uint8Array, delta: Uint8Array, options?: {
    maxResultSize?: number;
}): Uint8Array;
/**
 * Async version of readPackfile that properly handles zlib decompression.
 * Uses fflate's synchronous inflate which reports consumed bytes, enabling
 * deterministic zlib frame boundary detection without binary search.
 */
export declare function readPackfileAsync(data: Uint8Array, bucket: R2Bucket, limits?: PackfileReadLimits): Promise<string[]>;
export { applyDelta };
//# sourceMappingURL=packfile-reader.d.ts.map