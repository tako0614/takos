/**
 * File-backed persistent implementation of Cloudflare R2 (S3-compatible object storage).
 *
 * Stores bucket contents as base64-encoded JSON on disk so that objects
 * survive process restarts. Intended for local development and testing
 * where a real R2 bucket is not available.
 */
import type { R2Bucket } from '../shared/types/bindings.ts';
export declare function createPersistentR2Bucket(filePath: string): R2Bucket;
//# sourceMappingURL=persistent-r2.d.ts.map