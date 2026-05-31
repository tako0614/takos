/**
 * Shared helpers for object-store-compatible object store adapters (S3, GCS, etc.).
 *
 * Contains the common logic for building ObjectStoreObject / ObjectStoreObjectBody shapes and
 * normalising request bodies, so that individual backend adapters only need
 * to handle backend-specific SDK translation.
 */

import type {
  ObjectStoreObject,
  ObjectStoreObjectBody,
} from "../shared/types/bindings.ts";
import type {
  ObjectStoreChecksumsLike,
  ObjectStoreHttpMetadataLike,
} from "./r2-compat-types.ts";
import { Buffer } from "node:buffer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Backend-independent metadata bag fed into the shared ObjectStoreObject builder. */
export interface ObjectStoreObjectMeta {
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

/** Build an empty ObjectStoreChecksums-compatible object. */
export function emptyChecksums(): ObjectStoreChecksumsLike {
  return {
    toJSON() {
      return {};
    },
  };
}

/**
 * Build the common ObjectStoreObject shape from backend-independent metadata.
 */
export function toObjectStoreObject(
  meta: ObjectStoreObjectMeta,
): ObjectStoreObject {
  const httpMetadata: ObjectStoreHttpMetadataLike = {
    contentType: meta.contentType,
  };

  const object: ObjectStoreObject = {
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
 * Wrap an already-fetched ArrayBuffer (+ its ObjectStoreObject metadata) as an
 * ObjectStoreObjectBody, providing the body / bodyUsed / arrayBuffer / text / json /
 * blob accessors that match the Cloudflare ObjectStoreObjectBody contract.
 */
export function toObjectStoreObjectBody(
  base: ObjectStoreObject,
  bytes: ArrayBuffer,
): ObjectStoreObjectBody {
  const contentType = base.httpMetadata?.contentType ??
    "application/octet-stream";

  let bodyUsed = false;

  const bodyStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });

  const objectBody: ObjectStoreObjectBody = {
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
