/**
 * Google Cloud Firestore implementation of the Cloudflare KVNamespace
 * binding interface.
 *
 * Each key is stored as a Firestore document in the configured collection.
 * TTL is handled both by Firestore's native TTL policy (for automatic
 * cleanup) and by manual expiration checks on read (to handle the TTL
 * propagation lag).
 */

import type { KVNamespace } from '../shared/types/bindings.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type FirestoreKvStoreConfig = {
  projectId?: string;
  keyFilePath?: string;
  /** Firestore collection name to store KV entries. */
  collectionName: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function isExpired(expiration: number | null | undefined): boolean {
  if (!expiration || expiration <= 0) return false;
  return expiration <= nowEpoch();
}

function serializeValue(value: string | ArrayBuffer | ReadableStream): Promise<string> | string {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);

  // ReadableStream
  return (async () => {
    const reader = (value as ReadableStream).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(combined);
  })();
}

function coerceValue(raw: string, type?: string): unknown {
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
// Minimal Firestore type shapes (optional dependency — cannot import types)
// ---------------------------------------------------------------------------

/** Minimal document snapshot shape returned by Firestore queries. */
type FirestoreDocSnapshot = {
  exists: boolean;
  id: string;
  data(): Record<string, unknown> | undefined;
};

/** Minimal query shape supporting the chaining methods used in `list()`. */
type FirestoreQuery = {
  where(field: string, op: string, value: unknown): FirestoreQuery;
  startAfter(doc: unknown): FirestoreQuery;
  limit(n: number): FirestoreQuery;
  get(): Promise<{ docs: FirestoreDocSnapshot[] }>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createFirestoreKvStore(config: FirestoreKvStoreConfig): KVNamespace {
  // Lazy-init Firestore client to avoid import cost when not used.
  // `unknown` is used because @google-cloud/firestore is an optional
  // dependency and its types may not be available at compile time.
  let firestorePromise: Promise<unknown> | undefined;

  async function getFirestore(): Promise<unknown> {
    if (!firestorePromise) {
      firestorePromise = (async () => {
        // @ts-expect-error — @google-cloud/firestore is an optional dependency
        const { Firestore } = await import('@google-cloud/firestore');
        return new Firestore({
          ...(config.projectId ? { projectId: config.projectId } : {}),
          ...(config.keyFilePath ? { keyFilename: config.keyFilePath } : {}),
        });
      })();
    }
    return firestorePromise;
  }

  async function getCollection() {
    const db = await getFirestore() as { collection(name: string): unknown };
    return db.collection(config.collectionName) as {
      doc(id: string): {
        get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined; id: string }>;
        set(data: Record<string, unknown>): Promise<void>;
        delete(): Promise<void>;
        path: string;
      };
      orderBy(field: string): FirestoreQuery;
    };
  }

  return {
    // -- get ---------------------------------------------------------------
    async get(
      key: string,
      type?: 'text' | 'json' | 'arrayBuffer' | 'stream',
    ): Promise<string | null> {
      const col = await getCollection();
      const doc = await col.doc(key).get();
      if (!doc.exists) return null;

      const data = doc.data()!;
      if (isExpired(data.expiration as number | null | undefined)) return null;

      // Return type is declared as `string | null` to match the default
      // KVNamespace.get() overload.  When `type` is 'json', 'arrayBuffer',
      // or 'stream' the actual runtime value differs — this mirrors the
      // overloaded behaviour of the Cloudflare KVNamespace interface.
      return coerceValue(data.value as string, type) as string | null;
    },

    // -- getWithMetadata ---------------------------------------------------
    async getWithMetadata(
      key: string,
      type?: 'text' | 'json' | 'arrayBuffer' | 'stream',
    ): Promise<{ value: unknown; metadata: Record<string, string> | null; cacheStatus: null }> {
      const col = await getCollection();
      const doc = await col.doc(key).get();

      if (!doc.exists) {
        return { value: null, metadata: null, cacheStatus: null };
      }

      const data = doc.data()!;
      if (isExpired(data.expiration as number | null | undefined)) {
        return { value: null, metadata: null, cacheStatus: null };
      }

      return {
        value: coerceValue(data.value as string, type),
        metadata: (data.metadata as Record<string, string>) ?? null,
        cacheStatus: null,
      };
    },

    // -- put ---------------------------------------------------------------
    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream,
      options?: {
        expirationTtl?: number;
        expiration?: number;
        metadata?: Record<string, string>;
      },
    ): Promise<void> {
      const serialized = await serializeValue(value);

      let expiration: number | null = null;
      if (options?.expiration !== undefined) {
        expiration = options.expiration;
      } else if (options?.expirationTtl !== undefined) {
        expiration = nowEpoch() + options.expirationTtl;
      }

      const col = await getCollection();
      await col.doc(key).set({
        value: serialized,
        metadata: options?.metadata ?? null,
        expiration,
        createdAt: new Date(),
      });
    },

    // -- delete ------------------------------------------------------------
    async delete(key: string): Promise<void> {
      const col = await getCollection();
      await col.doc(key).delete();
    },

    // -- list --------------------------------------------------------------
    async list(
      options?: { prefix?: string; limit?: number; cursor?: string },
    ): Promise<{
      keys: Array<{ name: string; expiration?: number; metadata?: Record<string, string> }>;
      list_complete: boolean;
      cursor?: string;
    }> {
      const limit = options?.limit ?? 1000;
      const col = await getCollection();
      const now = nowEpoch();

      let query = col.orderBy('__name__');

      // Prefix filtering: Firestore range query on document ID
      if (options?.prefix) {
        const prefix = options.prefix;
        // endBefore the next character after the last char of prefix
        const prefixEnd = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
        query = query.where('__name__', '>=', col.doc(prefix).path)
                     .where('__name__', '<', col.doc(prefixEnd).path);
      }

      // Cursor-based pagination
      if (options?.cursor) {
        const cursorDocId = Buffer.from(options.cursor, 'base64').toString('utf-8');
        const cursorDoc = await col.doc(cursorDocId).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      // Fetch one extra to determine if the list is complete
      const snapshot = await query.limit(limit + 1).get();

      const keys: Array<{ name: string; expiration?: number; metadata?: Record<string, string> }> = [];

      for (const doc of snapshot.docs.slice(0, limit)) {
        const data = doc.data();
        if (!data) continue;
        const exp = data.expiration as number | null;

        // Skip expired entries
        if (exp && exp > 0 && exp <= now) continue;

        const entry: { name: string; expiration?: number; metadata?: Record<string, string> } = {
          name: doc.id,
        };
        if (exp && exp > 0) entry.expiration = exp;
        if (data.metadata) entry.metadata = data.metadata as Record<string, string>;

        keys.push(entry);
      }

      const listComplete = snapshot.docs.length <= limit;
      let cursor: string | undefined;
      if (!listComplete && snapshot.docs.length > 0) {
        const lastDoc = snapshot.docs[limit - 1];
        cursor = Buffer.from(lastDoc.id).toString('base64');
      }

      return {
        keys,
        list_complete: listComplete,
        ...(cursor ? { cursor } : {}),
      };
    },
  // Cast required: this object structurally implements the KVNamespace
  // interface, but TypeScript cannot verify compatibility with the
  // Cloudflare Workers type definitions without the runtime environment.
  } as unknown as KVNamespace;
}
