import type {
  KVNamespace,
} from '../shared/types/bindings.ts';

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
