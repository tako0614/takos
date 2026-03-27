import type { KVNamespace } from '../shared/types/bindings.ts';
import { readJsonFile, writeJsonFile } from './persistent-shared.ts';

type KvRecord = {
  value: string;
  expiration?: number;
  metadata?: unknown;
};

type KvState = Record<string, KvRecord>;

export function createPersistentKVNamespace(filePath: string): KVNamespace {
  let cache: KvState | null = null;

  async function loadState(): Promise<KvState> {
    if (cache) return cache;
    cache = await readJsonFile<KvState>(filePath, {});
    return cache;
  }

  async function flushState(): Promise<void> {
    if (!cache) return;
    await writeJsonFile(filePath, cache);
  }

  async function getRecord(key: string): Promise<KvRecord | null> {
    const state = await loadState();
    const record = state[key];
    if (!record) return null;
    if (record.expiration && Date.now() >= record.expiration) {
      delete state[key];
      await flushState();
      return null;
    }
    return record;
  }

  const kv = {
    async get<T = unknown>(key: string, arg?: unknown): Promise<T | string | ArrayBuffer | ReadableStream | null> {
      const record = await getRecord(key);
      if (!record) return null;

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
      const record = await getRecord(key);
      if (!record) {
        return { value: null, metadata: null, cacheStatus: null };
      }
      const value = await kv.get<T>(key, arg);
      return {
        value,
        metadata: record.metadata ?? null,
        cacheStatus: null,
      };
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream | ArrayBufferView,
      options?: { expirationTtl?: number; expiration?: number; metadata?: unknown },
    ) {
      const state = await loadState();
      let text: string;
      if (typeof value === 'string') {
        text = value;
      } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        text = new TextDecoder().decode(value);
      } else {
        text = await new Response(value).text();
      }

      state[key] = {
        value: text,
        expiration: options?.expiration
          ? options.expiration * 1000
          : options?.expirationTtl
            ? Date.now() + options.expirationTtl * 1000
            : undefined,
        metadata: options?.metadata,
      };
      await flushState();
    },
    async delete(key: string) {
      const state = await loadState();
      delete state[key];
      await flushState();
    },
    async list<Metadata = unknown>(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const state = await loadState();
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
      const entries = Object.entries(state)
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
