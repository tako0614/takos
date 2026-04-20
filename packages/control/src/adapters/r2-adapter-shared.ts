/**
 * Shared helpers for R2-compatible object store adapters (S3, GCS, etc.).
 *
 * Contains the common logic for building R2Object / R2ObjectBody shapes and
 * normalising request bodies, so that individual backend adapters only need
 * to handle backend-specific SDK translation.
 */

import type { R2Object, R2ObjectBody } from "../shared/types/bindings.ts";
import type { R2ChecksumsLike, R2HTTPMetadataLike } from "./r2-compat-types.ts";
import { Buffer } from "node:buffer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Backend-independent metadata bag fed into the shared R2Object builder. */
export interface R2ObjectMeta {
  key: string;
  etag: string;
  httpEtag: string;
  size: number;
  version: string;
  uploaded: Date;
  contentType?: string;
  customMetadata: Record<string, string>;
  range?: { offset: number; length?: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an empty R2Checksums-compatible object. */
export function emptyChecksums(): R2ChecksumsLike {
  return {
    toJSON() {
      return {};
    },
  };
}

/**
 * Build the common R2Object shape from backend-independent metadata.
 */
export function toR2Object(meta: R2ObjectMeta): R2Object {
  const httpMetadata: R2HTTPMetadataLike = {
    contentType: meta.contentType,
  };

  const object: R2Object = {
    key: meta.key,
    version: meta.version,
    size: meta.size,
    etag: meta.etag,
    httpEtag: meta.httpEtag,
    checksums: emptyChecksums(),
    uploaded: meta.uploaded,
    httpMetadata,
    customMetadata: meta.customMetadata,
    ...(meta.range ? { range: meta.range } : {}),
    writeHttpMetadata(_headers: Headers) {
      // no-op – Cloudflare-specific helper
    },
  };
  return object;
}

/**
 * Wrap an already-fetched ArrayBuffer (+ its R2Object metadata) as an
 * R2ObjectBody, providing the body / bodyUsed / arrayBuffer / text / json /
 * blob accessors that match the Cloudflare R2ObjectBody contract.
 */
export function toR2ObjectBody(
  base: R2Object,
  bytes: ArrayBuffer,
): R2ObjectBody {
  const contentType = base.httpMetadata?.contentType ??
    "application/octet-stream";

  let bodyUsed = false;

  const bodyStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });

  const objectBody: R2ObjectBody = {
    ...base,
    body: bodyStream,
    get bodyUsed() {
      return bodyUsed;
    },
    async arrayBuffer() {
      bodyUsed = true;
      return bytes;
    },
    async text() {
      bodyUsed = true;
      return new TextDecoder().decode(bytes);
    },
    async json<T = unknown>(): Promise<T> {
      bodyUsed = true;
      const t = new TextDecoder().decode(bytes);
      return JSON.parse(t) as T;
    },
    async blob() {
      bodyUsed = true;
      return new Blob([bytes], { type: contentType });
    },
    writeHttpMetadata(_headers: Headers) {
      // no-op
    },
  };

  return objectBody;
}

/**
 * Normalise the value passed to put() into a format that both S3 PutObject and
 * GCS file.save() can accept (Buffer | Uint8Array | string).
 */
export async function normaliseBody(
  value: ReadableStream | ArrayBuffer | string | null | Blob,
): Promise<Buffer | Uint8Array | string | undefined> {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Uint8Array) return value;
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    const ab = await value.arrayBuffer();
    return Buffer.from(ab);
  }
  // ReadableStream – collect into a Buffer
  const reader = (value as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
