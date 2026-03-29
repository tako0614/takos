/**
 * R2 bucket methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare R2 object-storage buckets that are bound to tenant
 * workers. Provides CRUD for buckets, object listing, upload (via the
 * S3-compatible PUT endpoint), deletion, and basic usage statistics.
 */
import type { WfpContext } from './wfp-contracts';
/**
 * Create an R2 bucket for tenant.
 */
export declare function createR2Bucket(ctx: WfpContext, name: string): Promise<void>;
/**
 * Delete an R2 bucket.
 */
export declare function deleteR2Bucket(ctx: WfpContext, name: string): Promise<void>;
/**
 * List objects in an R2 bucket.
 */
export declare function listR2Objects(ctx: WfpContext, bucketName: string, options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
}): Promise<{
    objects: Array<{
        key: string;
        size: number;
        uploaded: string;
        etag: string;
    }>;
    truncated: boolean;
    cursor?: string;
}>;
/**
 * Upload a file to R2 bucket using S3-compatible API.
 * Uses raw fetch because the R2 object upload endpoint requires
 * Content-Type on the request (not JSON-wrapped).
 */
export declare function uploadToR2(ctx: WfpContext, bucketName: string, key: string, body: ReadableStream<Uint8Array> | ArrayBuffer | string, options?: {
    contentType?: string;
}): Promise<void>;
/**
 * Delete an object from an R2 bucket.
 */
export declare function deleteR2Object(ctx: WfpContext, bucketName: string, key: string): Promise<void>;
/**
 * Get R2 bucket usage stats.
 */
export declare function getR2BucketStats(ctx: WfpContext, bucketName: string): Promise<{
    objectCount: number;
    payloadSize: number;
    metadataSize: number;
}>;
//# sourceMappingURL=r2.d.ts.map