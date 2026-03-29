/**
 * In-memory implementation of Cloudflare R2 (S3-compatible object storage).
 *
 * Used for local development and testing where a real R2 bucket is not
 * available. All stored objects live in memory and are lost when the
 * process exits.
 */
import type { R2Bucket } from '../shared/types/bindings.ts';
export declare function createInMemoryR2Bucket(): R2Bucket;
//# sourceMappingURL=in-memory-r2.d.ts.map