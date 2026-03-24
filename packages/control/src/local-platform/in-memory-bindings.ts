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

function createD1Meta(): Record<string, unknown> {
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
  const statement = {
    bind(..._values: unknown[]) {
      return statement;
    },
    async first<T = Record<string, unknown>>(_colName?: string): Promise<T | null> {
      return null;
    },
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return {
        results: [],
        success: true,
        meta: createD1Meta(),
      } as unknown as D1Result<T>;
    },
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return {
        results: [],
        success: true,
        meta: createD1Meta(),
      } as unknown as D1Result<T>;
    },
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
      if (options?.columnNames) {
        return [[]] as [string[], ...T[]];
      }
      return [];
    },
  };

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
  };

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

function createR2Object(key: string, bytes: ArrayBuffer, customMetadata: Record<string, string>, httpMetadata: Record<string, string>): R2ObjectBody {
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
  const objects = new Map<string, { bytes: ArrayBuffer; customMetadata: Record<string, string>; httpMetadata: Record<string, string> }>();

  const bucket = {
    async head(key: string) {
      const record = objects.get(key);
      if (!record) return null;
      const object = createR2Object(key, record.bytes, record.customMetadata, record.httpMetadata);
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
      return createR2Object(key, bytes, record.customMetadata, record.httpMetadata);
    },
    async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null, options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> }) {
      const bytes = await toBuffer(value);
      objects.set(key, {
        bytes,
        customMetadata: options?.customMetadata ?? {},
        httpMetadata: options?.httpMetadata ?? {},
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
    async createMultipartUpload() {
      throw new Error('Multipart upload is not implemented in the local adapter');
    },
    resumeMultipartUpload() {
      throw new Error('Multipart upload is not implemented in the local adapter');
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
