/**
 * Vectorize index methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare Vectorize indexes that are bound to tenant workers.
 * Provides creation (with configurable dimensions and distance metric) and
 * deletion of vector search indexes.
 */
import type { WfpContext } from './wfp-contracts';
/**
 * Create a Vectorize index.
 */
export declare function createVectorizeIndex(ctx: WfpContext, name: string, config: {
    dimensions: number;
    metric: 'cosine' | 'euclidean' | 'dot-product';
}): Promise<string>;
/**
 * Delete a Vectorize index.
 */
export declare function deleteVectorizeIndex(ctx: WfpContext, name: string): Promise<void>;
//# sourceMappingURL=vectorize.d.ts.map