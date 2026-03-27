import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  DurableObjectNamespace,
  DurableObjectStub,
  KVNamespace,
  Queue,
  R2Bucket,
  R2Object,
  R2ObjectBody,
} from '../shared/types/bindings.ts';
import type { LocalQueue, LocalQueueRecord } from './queue-runtime.ts';

export type InMemoryDurableObjectNamespace = DurableObjectNamespace & {
  getByName(name: string): DurableObjectStub;
};

/**
 * Structural mirror interfaces for the Cloudflare abstract classes.
 * These allow `satisfies` checks on mock objects without requiring
 * class inheritance from the abstract originals.
 */
interface D1MetaShape {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
  [key: string]: unknown;
}

interface D1ResultShape<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: D1MetaShape;
}

interface D1PreparedStatementShape {
  bind(...values: unknown[]): D1PreparedStatementShape;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1ResultShape<T>>;
  all<T = Record<string, unknown>>(): Promise<D1ResultShape<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]>;
}

interface D1DatabaseShape {
  prepare(query: string): D1PreparedStatementShape;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatementShape[]): Promise<D1ResultShape<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  withSession(): { prepare(query: string): D1PreparedStatementShape; batch<T = Record<string, unknown>>(statements: D1PreparedStatementShape[]): Promise<D1ResultShape<T>[]>; getBookmark(): null };
  dump(): Promise<ArrayBuffer>;
}

function createD1Meta(): D1MetaShape {
  return {
    changed_db: false,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    served_by: 'local',
    size_after: 0,
  };
}

function createPreparedStatement(): D1PreparedStatement {
  const statement: D1PreparedStatementShape = {
    bind(..._values: unknown[]) {
      return statement;
    },
    async first<T = Record<string, unknown>>(_colName?: string): Promise<T | null> {
      return null;
    },
    async run<T = Record<string, unknown>>(): Promise<D1ResultShape<T>> {
      return {
        results: [] as T[],
        success: true,
        meta: createD1Meta(),
      } satisfies D1ResultShape<T>;
    },
    async all<T = Record<string, unknown>>(): Promise<D1ResultShape<T>> {
      return {
        results: [] as T[],
        success: true,
        meta: createD1Meta(),
      } satisfies D1ResultShape<T>;
    },
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
      if (options?.columnNames) {
        return [[]] as [string[], ...T[]];
      }
      return [];
    },
  };

  // The mock satisfies D1PreparedStatementShape structurally; the abstract class
  // boundary requires a cast at the return site.
  return statement as unknown as D1PreparedStatement;
}

export function createInMemoryD1Database(): D1Database {
  const session = {
    prepare(_query: string) {
      return createPreparedStatement();
    },
    async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run<T>()));
    },
    getBookmark() {
      return null;
    },
  };

  const db = {
    prepare(_query: string) {
      return createPreparedStatement();
    },
    async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run<T>()));
    },
    async exec(_query: string) {
      return { count: 0, duration: 0 };
    },
    withSession() {
      return session;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } satisfies D1DatabaseShape;

  // The mock satisfies D1DatabaseShape structurally; the abstract class
  // boundary requires a single cast at the return site.
  return db as unknown as D1Database;
}

export function createInMemoryKVNamespace(): KVNamespace {
  const values = new Map<string, { value: string; expiration?: number; metadata?: unknown }>();

  const kv = {
    async get<T = unknown>(key: string, arg?: unknown): Promise<T | string | ArrayBuffer | ReadableStream | null> {
      const record = values.get(key);
      if (!record) return null;
      if (record.expiration && Date.now() >= record.expiration) {
        values.delete(key);
        return null;
      }

      const type = typeof arg === 'string'
        ? arg
        : typeof arg === 'object' && arg && 'type' in (arg as Record<string, unknown>)
          ? (arg as { type?: string }).type ?? 'text'
          : 'text';

      if (type === 'json') return JSON.parse(record.value) as T;
      if (type === 'arrayBuffer') return new TextEncoder().encode(record.value).buffer;
      if (type === 'stream') return new Blob([record.value]).stream();
      return record.value;
    },
    async getWithMetadata<T = string>(key: string, arg?: unknown) {
      const value = await kv.get<T>(key, arg);
      const record = values.get(key);
      return {
        value,
        metadata: record?.metadata ?? null,
        cacheStatus: null,
      };
    },
    async put(key: string, value: string | ArrayBuffer | ReadableStream | ArrayBufferView, options?: { expirationTtl?: number; expiration?: number; metadata?: unknown }) {
      let text: string;
      if (typeof value === 'string') {
        text = value;
      } else if (value instanceof ArrayBuffer) {
        text = new TextDecoder().decode(value);
      } else if (ArrayBuffer.isView(value)) {
        text = new TextDecoder().decode(value);
      } else {
        text = await new Response(value).text();
      }
      values.set(key, {
        value: text,
        expiration: options?.expiration
          ? options.expiration * 1000
          : options?.expirationTtl
            ? Date.now() + options.expirationTtl * 1000
            : undefined,
        metadata: options?.metadata,
      });
    },
    async delete(key: string) {
      values.delete(key);
    },
    async list<Metadata = unknown>(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
      const entries = Array.from(values.entries())
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));
      const page = entries.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        keys: page.map(([name, record]) => ({
          name,
          expiration: record.expiration ? Math.floor(record.expiration / 1000) : undefined,
          metadata: record.metadata as Metadata,
        })),
        list_complete: nextOffset >= entries.length,
        cursor: nextOffset >= entries.length ? '' : String(nextOffset),
        cacheStatus: null,
      };
    },
  };

  return kv as unknown as KVNamespace;
}

async function toBuffer(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
): Promise<ArrayBuffer> {
  if (value === null) return new ArrayBuffer(0);
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  if (value instanceof Blob) return value.arrayBuffer();
  return new Response(value).arrayBuffer();
}

function normalizeHttpMetadata(metadata?: Record<string, string> | Headers): Record<string, string> {
  if (!metadata) return {};
  if (metadata instanceof Headers) {
    return Object.fromEntries(metadata.entries());
  }
  return { ...metadata };
}

function createR2Object(
  key: string,
  bytes: ArrayBuffer,
  customMetadata: Record<string, string>,
  httpMetadata: Record<string, string>,
  storageClass = 'Standard',
): R2ObjectBody {
  const blob = new Blob([bytes]);
  const etag = `"${key}-${bytes.byteLength}"`;
  const object = {
    key,
    version: 'local',
    size: bytes.byteLength,
    etag,
    httpEtag: etag,
    uploaded: new Date(),
    checksums: { toJSON: () => ({}) },
    httpMetadata,
    customMetadata,
    storageClass,
    range: undefined,
    body: blob.stream(),
    bodyUsed: false,
    async arrayBuffer() {
      return bytes.slice(0);
    },
    async bytes() {
      return new Uint8Array(bytes.slice(0));
    },
    async text() {
      return new TextDecoder().decode(bytes);
    },
    async json<T>() {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    },
    async blob() {
      return blob;
    },
    writeHttpMetadata(headers: Headers) {
      for (const [name, value] of Object.entries(httpMetadata)) {
        headers.set(name, value);
      }
    },
  };

  return object as unknown as R2ObjectBody;
}

export function createInMemoryR2Bucket(): R2Bucket {
  const objects = new Map<string, {
    bytes: ArrayBuffer;
    customMetadata: Record<string, string>;
    httpMetadata: Record<string, string>;
    storageClass: string;
  }>();
  const multipartUploads = new Map<string, {
    key: string;
    customMetadata: Record<string, string>;
    httpMetadata: Record<string, string>;
    storageClass: string;
    parts: Map<number, { bytes: ArrayBuffer; etag: string }>;
  }>();

  async function toPartEtag(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `"${hex}"`;
  }

  async function toUploadedBytes(parts: Array<{ partNumber: number; etag: string }>, upload: {
    parts: Map<number, { bytes: ArrayBuffer; etag: string }>;
  }): Promise<ArrayBuffer> {
    const orderedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const buffers: Uint8Array[] = [];
    const seen = new Set<number>();
    let totalLength = 0;

    for (const part of orderedParts) {
      if (seen.has(part.partNumber)) {
        throw new Error(`Multipart upload has duplicate part ${part.partNumber}`);
      }
      seen.add(part.partNumber);

      const storedPart = upload.parts.get(part.partNumber);
      if (!storedPart) {
        throw new Error(`Multipart upload is missing part ${part.partNumber}`);
      }
      if (storedPart.etag !== part.etag) {
        throw new Error(`Multipart upload part ${part.partNumber} etag mismatch`);
      }
      const bytes = new Uint8Array(storedPart.bytes);
      buffers.push(bytes);
      totalLength += bytes.byteLength;
    }

    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      merged.set(buffer, offset);
      offset += buffer.byteLength;
    }
    return merged.buffer;
  }

  function requireMultipartUpload(uploadId: string, key: string) {
    const upload = multipartUploads.get(uploadId);
    if (!upload) {
      throw new Error(`Multipart upload ${uploadId} is not active`);
    }
    if (upload.key !== key) {
      throw new Error(`Multipart upload ${uploadId} belongs to a different key`);
    }
    return upload;
  }

  const bucket = {
    async head(key: string) {
      const record = objects.get(key);
      if (!record) return null;
      const object = createR2Object(key, record.bytes, record.customMetadata, record.httpMetadata, record.storageClass);
      return {
        ...object,
        body: null,
      } as unknown as R2Object;
    },
    async get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }) {
      const record = objects.get(key);
      if (!record) return null;
      let bytes = record.bytes;
      if (options?.range) {
        const offset = options.range.suffix
          ? Math.max(0, bytes.byteLength - options.range.suffix)
          : options.range.offset ?? 0;
        const end = options.range.length !== undefined
          ? Math.min(bytes.byteLength, offset + options.range.length)
          : bytes.byteLength;
        bytes = bytes.slice(offset, end);
      }
      return createR2Object(key, bytes, record.customMetadata, record.httpMetadata, record.storageClass);
    },
    async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null, options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string>; storageClass?: string }) {
      const bytes = await toBuffer(value);
      objects.set(key, {
        bytes,
        customMetadata: { ...(options?.customMetadata ?? {}) },
        httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
        storageClass: options?.storageClass ?? 'Standard',
      });
      return (await bucket.head(key))!;
    },
    async delete(key: string | string[]) {
      if (Array.isArray(key)) {
        for (const item of key) objects.delete(item);
        return;
      }
      objects.delete(key);
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
      const keys = Array.from(objects.keys())
        .filter((key) => key.startsWith(prefix))
        .sort();
      const page = keys.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        objects: await Promise.all(page.map(async (key) => (await bucket.head(key))!)),
        truncated: nextOffset < keys.length,
        cursor: nextOffset < keys.length ? String(nextOffset) : undefined,
        delimitedPrefixes: [],
      };
    },
    async createMultipartUpload(key: string, options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> | Headers; storageClass?: string; ssecKey?: ArrayBuffer | string }) {
      const uploadId = crypto.randomUUID();
      multipartUploads.set(uploadId, {
        key,
        customMetadata: { ...(options?.customMetadata ?? {}) },
        httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
        storageClass: options?.storageClass ?? 'Standard',
        parts: new Map<number, { bytes: ArrayBuffer; etag: string }>(),
      });

      return {
        key,
        uploadId,
        async uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, _options?: { ssecKey?: ArrayBuffer | string }) {
          const bytes = await toBuffer(value);
          const etag = await toPartEtag(bytes);
          const upload = requireMultipartUpload(uploadId, key);
          upload.parts.set(partNumber, { bytes, etag });
          return { partNumber, etag };
        },
        async abort() {
          const upload = requireMultipartUpload(uploadId, key);
          upload.parts.clear();
          multipartUploads.delete(uploadId);
        },
        async complete(uploadedParts: Array<{ partNumber: number; etag: string }>) {
          const upload = requireMultipartUpload(uploadId, key);
          const bytes = await toUploadedBytes(uploadedParts, upload);
          upload.parts.clear();
          multipartUploads.delete(uploadId);
          return bucket.put(key, bytes, {
            customMetadata: upload.customMetadata,
            httpMetadata: upload.httpMetadata,
            storageClass: upload.storageClass,
          });
        },
      };
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      requireMultipartUpload(uploadId, key);
      return {
        key,
        uploadId,
        async uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, _options?: { ssecKey?: ArrayBuffer | string }) {
          const bytes = await toBuffer(value);
          const etag = await toPartEtag(bytes);
          const activeUpload = requireMultipartUpload(uploadId, key);
          activeUpload.parts.set(partNumber, { bytes, etag });
          return { partNumber, etag };
        },
        async abort() {
          const activeUpload = requireMultipartUpload(uploadId, key);
          activeUpload.parts.clear();
          multipartUploads.delete(uploadId);
        },
        async complete(uploadedParts: Array<{ partNumber: number; etag: string }>) {
          const activeUpload = requireMultipartUpload(uploadId, key);
          const bytes = await toUploadedBytes(uploadedParts, activeUpload);
          activeUpload.parts.clear();
          multipartUploads.delete(uploadId);
          return bucket.put(key, bytes, {
            customMetadata: activeUpload.customMetadata,
            httpMetadata: activeUpload.httpMetadata,
            storageClass: activeUpload.storageClass,
          });
        },
      };
    },
  };

  return bucket as unknown as R2Bucket;
}

export function createInMemoryQueue<T = unknown>(queueName = 'takos-runs'): Queue<T> {
  const sent: Array<LocalQueueRecord<T>> = [];
  const queue = {
    queueName,
    sent,
    async send(message: T, options?: unknown) {
      sent.push({ body: message, options });
    },
    async sendBatch(messages: Iterable<unknown>) {
      for (const message of messages) sent.push(message as LocalQueueRecord<T>);
    },
    async receive() {
      return sent.shift() ?? null;
    },
  };

  return queue as unknown as LocalQueue<T>;
}

export function createInMemoryDurableObjectNamespace(
  factory?: (id: string) => DurableObjectStub,
): InMemoryDurableObjectNamespace {
  const stubs = new Map<string, DurableObjectStub>();

  const makeStub = (id: string): DurableObjectStub => {
    if (factory) return factory(id);
    return {
      id: {
        equals(other: { toString(): string }) {
          return other.toString() === id;
        },
        toString() {
          return id;
        },
        name: id,
      },
      name: id,
      async fetch() {
        return Response.json({ ok: true, durableObject: id }) as unknown as Response;
      },
      connect() {
        throw new Error('connect() is not supported in the local durable object stub');
      },
    } as unknown as DurableObjectStub;
  };

  const namespace = {
    newUniqueId() {
      const raw = crypto.randomUUID();
      return {
        equals(other: { toString(): string }) {
          return other.toString() === raw;
        },
        toString() {
          return raw;
        },
        name: raw,
      };
    },
    idFromName(name: string) {
      return {
        equals(other: { toString(): string }) {
          return other.toString() === name;
        },
        toString() {
          return name;
        },
        name,
      };
    },
    idFromString(id: string) {
      return {
        equals(other: { toString(): string }) {
          return other.toString() === id;
        },
        toString() {
          return id;
        },
        name: id,
      };
    },
    get(id: { toString(): string }) {
      const key = id.toString();
      if (!stubs.has(key)) stubs.set(key, makeStub(key));
      return stubs.get(key)!;
    },
    getByName(name: string) {
      return namespace.get(namespace.idFromName(name));
    },
    jurisdiction() {
      return namespace;
    },
  };

  return namespace as unknown as InMemoryDurableObjectNamespace;
}
