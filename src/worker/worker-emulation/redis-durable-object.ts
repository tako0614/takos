import { createClient } from "redis";
import type {
  DurableObjectNamespace,
  DurableObjectStub,
} from "../shared/types/bindings.ts";
import { logWarn } from "../shared/utils/logger.ts";

type RedisClient = ReturnType<typeof createClient>;

const REDIS_KEY_PREFIX = "takos:do";

type RedisClientState = {
  url: string;
  clientPromise: Promise<RedisClient>;
};

let redisClientState: RedisClientState | null = null;

async function getRedisClient(redisUrl: string): Promise<RedisClient> {
  if (redisClientState?.url !== redisUrl) {
    if (redisClientState) {
      void redisClientState.clientPromise
        .then((client) =>
          client.quit().catch((err) => {
            logWarn("Failed to quit stale Redis client", {
              module: "redis-durable-object",
              error: err instanceof Error ? err.message : String(err),
            });
            return undefined;
          })
        )
        .catch((err) => {
          logWarn("Failed to resolve stale Redis client for quit", {
            module: "redis-durable-object",
            error: err instanceof Error ? err.message : String(err),
          });
          return undefined;
        });
    }
    redisClientState = {
      url: redisUrl,
      clientPromise: createClient({ url: redisUrl }).connect(),
    };
  }
  return redisClientState.clientPromise;
}

export async function disposeRedisDurableObjectClient(): Promise<void> {
  if (!redisClientState) return;
  const state = redisClientState;
  redisClientState = null;
  await state.clientPromise
    .then((client) =>
      client.quit().catch((err) => {
        logWarn("Failed to quit Redis client during dispose", {
          module: "redis-durable-object",
          error: err instanceof Error ? err.message : String(err),
        });
        return undefined;
      })
    )
    .catch((err) => {
      logWarn("Failed to resolve Redis client for dispose", {
        module: "redis-durable-object",
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    });
}

function storageHashKey(prefix: string, instanceId: string): string {
  return `${REDIS_KEY_PREFIX}:${prefix}:${instanceId}:storage`;
}

/**
 * Creates a Redis-backed DurableObjectNamespace emulation.
 *
 * Each DO instance is identified by a name (from idFromName).
 * The stub's fetch() stores/retrieves state via Redis HASH operations,
 * delegating to a fetch handler that implements the DO's HTTP interface.
 *
 * @param redisUrl - Redis connection URL
 * @param prefix - Key prefix for this namespace (e.g., 'session', 'git-push-lock')
 * @param fetchHandler - Optional handler to process fetch requests against Redis-backed state.
 *   If not provided, the stub returns a simple JSON response.
 */
export function createRedisDurableObjectNamespace(
  redisUrl: string,
  prefix: string,
  fetchHandler?: (
    instanceId: string,
    storage: RedisDurableObjectStorage,
    request: Request,
  ) => Promise<Response>,
): DurableObjectNamespace {
  const stubs = new Map<string, DurableObjectStub>();

  function makeStub(id: string): DurableObjectStub {
    const storage = createRedisDurableObjectStorage(redisUrl, prefix, id);

    return {
      async fetch(
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        if (fetchHandler) {
          const request = new Request(input, init);
          return fetchHandler(id, storage, request);
        }
        return Response.json({ ok: true, durableObject: id });
      },
    };
  }

  const namespace: DurableObjectNamespace = {
    idFromName(name: string) {
      return name;
    },
    get(id: unknown) {
      const key = typeof id === "string" ? id : String(id);
      if (!stubs.has(key)) stubs.set(key, makeStub(key));
      return stubs.get(key)!;
    },
    getByName(name: string) {
      return namespace.get(namespace.idFromName(name));
    },
  };

  return namespace;
}

/**
 * Redis-backed storage for a Durable Object instance.
 * Provides get/put/delete/list on a Redis HASH per instance.
 */
export type RedisDurableObjectStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  getMultiple<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  putMultiple(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteMultiple(keys: string[]): Promise<number>;
  list<T = unknown>(
    options?: { prefix?: string; limit?: number },
  ): Promise<Map<string, T>>;
};

export function createRedisDurableObjectStorage(
  redisUrl: string,
  prefix: string,
  instanceId: string,
): RedisDurableObjectStorage {
  const hashKey = storageHashKey(prefix, instanceId);

  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const client = await getRedisClient(redisUrl);
      const raw = await client.hGet(hashKey, key);
      if (raw === undefined || raw === null) return undefined;
      return JSON.parse(raw) as T;
    },

    async getMultiple<T = unknown>(keys: string[]): Promise<Map<string, T>> {
      const client = await getRedisClient(redisUrl);
      const result = new Map<string, T>();
      if (keys.length === 0) return result;
      const values = await client.hmGet(hashKey, keys);
      for (let i = 0; i < keys.length; i++) {
        const raw = values[i];
        if (raw !== null && raw !== undefined) {
          result.set(keys[i], JSON.parse(raw) as T);
        }
      }
      return result;
    },

    async put(key: string, value: unknown): Promise<void> {
      const client = await getRedisClient(redisUrl);
      await client.hSet(hashKey, key, JSON.stringify(value));
    },

    async putMultiple(entries: Record<string, unknown>): Promise<void> {
      const client = await getRedisClient(redisUrl);
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(entries)) {
        fields[key] = JSON.stringify(value);
      }
      if (Object.keys(fields).length > 0) {
        await client.hSet(hashKey, fields);
      }
    },

    async delete(key: string): Promise<boolean> {
      const client = await getRedisClient(redisUrl);
      const count = await client.hDel(hashKey, key);
      return count > 0;
    },

    async deleteMultiple(keys: string[]): Promise<number> {
      if (keys.length === 0) return 0;
      const client = await getRedisClient(redisUrl);
      return await client.hDel(hashKey, keys);
    },

    async list<T = unknown>(
      options?: { prefix?: string; limit?: number },
    ): Promise<Map<string, T>> {
      const client = await getRedisClient(redisUrl);
      const all = await client.hGetAll(hashKey);
      const result = new Map<string, T>();
      const prefix = options?.prefix ?? "";
      const limit = options?.limit ?? Infinity;
      const entries = Object.entries(all)
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));
      for (const [key, raw] of entries) {
        if (result.size >= limit) break;
        result.set(key, JSON.parse(raw) as T);
      }
      return result;
    },
  };
}
