import type { ObjectStoreObject } from "../shared/types/bindings.ts";

// ---------------------------------------------------------------------------
// object store compatibility types
//
// These interfaces mirror the provider runtime R2 shapes so that non-provider
// object-store adapters (S3, GCS, …) can produce values that satisfy the same
// contracts without depending on provider ambient worker types.
// ---------------------------------------------------------------------------

// ObjectStoreObjects is not re-exported from bindings, define inline to match the Cloudflare shape.
export interface ObjectStoreObjects {
  objects: ObjectStoreObject[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

/** Matches the shape of object storeChecksums without requiring the abstract class import. */
export interface ObjectStoreChecksumsLike {
  readonly md5?: ArrayBuffer;
  readonly sha1?: ArrayBuffer;
  readonly sha256?: ArrayBuffer;
  readonly sha384?: ArrayBuffer;
  readonly sha512?: ArrayBuffer;
  toJSON(): Record<string, string | undefined>;
}

/** Matches the shape of Cloudflare ObjectStoreHttpMetadata. */
export interface ObjectStoreHttpMetadataLike {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

/** Matches the object storeRange type. */
export interface ObjectStoreRangeLike {
  offset: number;
  length?: number;
}
