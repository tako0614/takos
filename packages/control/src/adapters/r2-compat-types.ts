import type {
  R2Object,
} from '../shared/types/bindings.ts';

// ---------------------------------------------------------------------------
// Cloudflare R2 compatibility types
//
// These interfaces mirror the Cloudflare Workers R2 shapes so that non-R2
// object-store adapters (S3, GCS, …) can produce values that satisfy the same
// contracts without pulling in @cloudflare/workers-types as a dependency.
// ---------------------------------------------------------------------------

// R2Objects is not re-exported from bindings, define inline to match the Cloudflare shape.
export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

/** Matches the shape of Cloudflare R2Checksums without requiring the abstract class import. */
export interface R2ChecksumsLike {
  readonly md5?: ArrayBuffer;
  readonly sha1?: ArrayBuffer;
  readonly sha256?: ArrayBuffer;
  readonly sha384?: ArrayBuffer;
  readonly sha512?: ArrayBuffer;
  toJSON(): Record<string, string | undefined>;
}

/** Matches the shape of Cloudflare R2HTTPMetadata. */
export interface R2HTTPMetadataLike {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

/** Matches the Cloudflare R2Range type. */
export interface R2RangeLike {
  offset: number;
  length?: number;
}

