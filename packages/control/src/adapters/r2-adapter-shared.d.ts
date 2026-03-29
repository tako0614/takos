/**
 * Shared helpers for R2-compatible object store adapters (S3, GCS, etc.).
 *
 * Contains the common logic for building R2Object / R2ObjectBody shapes and
 * normalising request bodies, so that individual provider adapters only need
 * to handle provider-specific SDK translation.
 */
import type { R2Object, R2ObjectBody } from '../../shared/types/bindings.ts';
import type { R2ChecksumsLike } from './r2-compat-types.ts';
/** Provider-neutral metadata bag fed into the shared R2Object builder. */
export interface R2ObjectMeta {
    key: string;
    etag: string;
    httpEtag: string;
    size: number;
    version: string;
    uploaded: Date;
    contentType?: string;
    customMetadata: Record<string, string>;
    range?: {
        offset: number;
        length?: number;
    };
}
/** Build an empty R2Checksums-compatible object. */
export declare function emptyChecksums(): R2ChecksumsLike;
/**
 * Build the common R2Object shape from provider-neutral metadata.
 */
export declare function toR2Object(meta: R2ObjectMeta): R2Object;
/**
 * Wrap an already-fetched ArrayBuffer (+ its R2Object metadata) as an
 * R2ObjectBody, providing the body / bodyUsed / arrayBuffer / text / json /
 * blob accessors that match the Cloudflare R2ObjectBody contract.
 */
export declare function toR2ObjectBody(base: R2Object, bytes: ArrayBuffer): R2ObjectBody;
/**
 * Normalise the value passed to put() into a format that both S3 PutObject and
 * GCS file.save() can accept (Buffer | Uint8Array | string).
 */
export declare function normaliseBody(value: ReadableStream | ArrayBuffer | string | null | Blob): Promise<Buffer | Uint8Array | string | undefined>;
//# sourceMappingURL=r2-adapter-shared.d.ts.map