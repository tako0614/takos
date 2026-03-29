/**
 * Shared helpers for KV store adapter implementations (DynamoDB, Firestore,
 * etc.).  These functions are backend-agnostic — they handle value coercion,
 * serialisation, TTL arithmetic and metadata parsing that every adapter needs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The `type` parameter accepted by `KVNamespace.get()`. */
export type KVValueType = 'text' | 'json' | 'arrayBuffer' | 'stream';

/** Shape returned by `KVNamespace.getWithMetadata()`. */
export type KVGetWithMetadataResult = {
  value: unknown;
  metadata: Record<string, string> | null;
  cacheStatus: null;
};

/** Shape of a single key entry returned by `KVNamespace.list()`. */
export type KVListKey = {
  name: string;
  expiration?: number;
  metadata?: Record<string, string>;
};

/** Shape returned by `KVNamespace.list()`. */
export type KVListResult = {
  keys: KVListKey[];
  list_complete: boolean;
  cursor?: string;
};

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Current time as a Unix epoch (seconds). */
export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Return `true` when an expiration timestamp indicates the entry has expired.
 * Handles the various shapes backends hand us (string from DynamoDB
 * `AttributeValue.N`, number from Firestore, or undefined/null).
 */
export function isExpired(expiration: string | number | null | undefined): boolean {
  if (expiration === undefined || expiration === null) return false;
  const exp = typeof expiration === 'string' ? Number(expiration) : expiration;
  return exp > 0 && exp <= nowEpoch();
}

// ---------------------------------------------------------------------------
// Expiration computation
// ---------------------------------------------------------------------------

/**
 * Derive the epoch-seconds expiration value from `put()` options.
 * Returns `null` when no expiration is configured.
 */
export function computeExpiration(options?: {
  expiration?: number;
  expirationTtl?: number;
}): number | null {
  if (options?.expiration !== undefined) return options.expiration;
  if (options?.expirationTtl !== undefined) return nowEpoch() + options.expirationTtl;
  return null;
}

// ---------------------------------------------------------------------------
// Value coercion (read path)
// ---------------------------------------------------------------------------

/**
 * Coerce a raw string value from the backing store into the requested type.
 *
 * Return type is declared as `unknown` because the actual JS type varies by
 * `type` parameter — callers cast as needed to satisfy the KVNamespace
 * overloads.
 */
export function coerceValue(raw: string, type?: KVValueType): unknown {
  switch (type) {
    case 'json':
      return JSON.parse(raw);
    case 'arrayBuffer':
      return new TextEncoder().encode(raw).buffer;
    case 'stream': {
      const bytes = new TextEncoder().encode(raw);
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    }
    case 'text':
    default:
      return raw;
  }
}

// ---------------------------------------------------------------------------
// Value serialisation (write path)
// ---------------------------------------------------------------------------

/**
 * Serialise an incoming value (string, ArrayBuffer or ReadableStream) into a
 * plain string suitable for storage.
 */
export async function serializeValue(
  value: string | ArrayBuffer | ReadableStream,
): Promise<string> {
  if (typeof value === 'string') return value;

  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(value);
  }

  // ReadableStream
  const reader = (value as ReadableStream).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined);
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

/**
 * Deserialise a metadata value. DynamoDB stores it as a JSON string;
 * Firestore stores it as a native map. This helper normalises both shapes.
 */
export function deserializeMetadata(
  raw: string | Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!raw) return null;
  if (typeof raw === 'string') return JSON.parse(raw) as Record<string, string>;
  return raw;
}
