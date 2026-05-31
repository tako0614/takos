import { createClient } from "redis";
import type {
  RoutingRecord,
  RoutingStore,
  RoutingTarget,
} from "../application/services/routing/routing-models.ts";
import type { MessageQueueBinding } from "../shared/types/bindings.ts";
import type { LocalQueue, LocalQueueRecord } from "./queue-runtime.ts";
import { logWarn } from "../shared/utils/logger.ts";

type QueueRecord<T = unknown> = LocalQueueRecord<T>;

type RedisClient = ReturnType<typeof createClient>;
type RedisClientFactory = typeof createClient;

const REDIS_KEY_PREFIX = "takos:local";

type RedisClientState = {
  url: string;
  clientPromise: Promise<RedisClient>;
};

let redisClientState: RedisClientState | null = null;
let redisClientFactory: RedisClientFactory = createClient;

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function cloneRecord(record: RoutingRecord | null): RoutingRecord | null {
  return record ? JSON.parse(JSON.stringify(record)) as RoutingRecord : null;
}

async function closeRedisClient(client: RedisClient): Promise<void> {
  const typedClient = client as RedisClient & {
    isOpen?: boolean;
    close?: () => Promise<void> | void;
    destroy?: () => void;
  };
  if (typedClient.isOpen === false) return;
  if (typedClient.close) {
    await Promise.resolve(typedClient.close()).catch((e) => {
      logWarn("Redis client close failed (non-critical)", {
        module: "redis-bindings",
        error: e instanceof Error ? e.message : String(e),
      });
    });
    return;
  }
  try {
    typedClient.destroy?.();
  } catch (e) {
    // Already-closed sockets during local smoke cleanup are expected.
    logWarn("Redis client destroy failed (non-critical)", {
      module: "redis-bindings",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function getRedisClient(redisUrl: string): Promise<RedisClient> {
  if (redisClientState?.url !== redisUrl) {
    if (redisClientState) {
      void redisClientState.clientPromise.then((client) =>
        closeRedisClient(client)
      ).catch((e) => {
        logWarn("Failed to close previous Redis client (non-critical)", {
          module: "redis-bindings",
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }

    redisClientState = {
      url: redisUrl,
      clientPromise: redisClientFactory({ url: redisUrl }).connect(),
    };
  }

  return redisClientState.clientPromise;
}

export async function disposeRedisClient(): Promise<void> {
  if (!redisClientState) return;
  const state = redisClientState;
  redisClientState = null;
  await state.clientPromise.then((client) => closeRedisClient(client)).catch(
    (e) => {
      logWarn("Failed to dispose Redis client (non-critical)", {
        module: "redis-bindings",
        error: e instanceof Error ? e.message : String(e),
      });
    },
  );
}

export function resetRedisClientForTests(): void {
  void disposeRedisClient();
}

export function setRedisClientFactoryForTests(
  factory: RedisClientFactory | null,
): void {
  void disposeRedisClient();
  redisClientFactory = factory ?? createClient;
}

function queueKey(queueName: string): string {
  return `${REDIS_KEY_PREFIX}:queue:${queueName}`;
}

function routingKey(hostname: string): string {
  return `${REDIS_KEY_PREFIX}:routing:${normalizeHostname(hostname)}`;
}

async function loadQueueRecords<T>(
  client: RedisClient,
  queueName: string,
): Promise<Array<QueueRecord<T>>> {
  const rawRecords = await client.lRange(queueKey(queueName), 0, -1);
  return rawRecords.map((record) => JSON.parse(record) as QueueRecord<T>);
}

export function createRedisQueue<T = unknown>(
  redisUrl: string,
  queueName: string,
): MessageQueueBinding<T> {
  const sent: Array<QueueRecord<T>> = [];
  let loadPromise: Promise<void> | null = null;

  async function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        const client = await getRedisClient(redisUrl);
        const records = await loadQueueRecords<T>(client, queueName);
        sent.splice(0, sent.length, ...records);
      })();
    }
    await loadPromise;
  }

  async function appendRecord(record: QueueRecord<T>): Promise<void> {
    const client = await getRedisClient(redisUrl);
    await client.rPush(queueKey(queueName), JSON.stringify(record));
    sent.push(record);
  }

  const queue: LocalQueue<T> = {
    queueName: queueName as LocalQueue<T>["queueName"],
    sent,
    async send(message: T, options?: unknown) {
      await ensureLoaded();
      await appendRecord({ body: message, options });
    },
    async sendBatch(messages: Iterable<unknown>) {
      await ensureLoaded();
      for (const message of messages) {
        await appendRecord(message as QueueRecord<T>);
      }
    },
    async receive() {
      await ensureLoaded();
      const client = await getRedisClient(redisUrl);
      // Redis is the source of truth for queue contents: the returned record is
      // parsed directly from the atomic lPop. The `sent` array is only a
      // best-effort local mirror for introspection and is not load-bearing, so
      // we keep it FIFO-consistent with the lPop via a cheap shift instead of
      // an O(n) JSON.stringify scan (which also mis-matched duplicate bodies).
      const rawRecord = await client.lPop(queueKey(queueName));
      if (!rawRecord) return null;
      const record = JSON.parse(rawRecord) as QueueRecord<T>;
      if (sent.length > 0) {
        sent.shift();
      }
      return record;
    },
  };

  void ensureLoaded().catch((e) => {
    logWarn("Redis queue initial load failed (non-critical)", {
      module: "redis-bindings",
      error: e instanceof Error ? e.message : String(e),
    });
  });

  return queue;
}

// Atomic read-modify-write for the routing record version bump. Redis is the
// shared multi-connection backend here, so a get-then-set in the application
// layer is a lost-update race: two concurrent writers to the same hostname
// both read version N and both write N+1, dropping one update and colliding
// the monotonic counter. This Lua script runs GET + compute(version+1) + SET
// as a single atomic server-side operation, so the version bump can never
// interleave with another writer's bump. KEYS[1] is the routing key; ARGV[1]
// is the JSON record body without `version`; ARGV[2] is the bump key path.
//
// The script reads the existing record's `version`, sets the new record's
// `version` to existing+1 (or 1 when absent), stores it, and returns the
// stored JSON so the caller observes the exact persisted record.
const ROUTING_PUT_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
local nextVersion = 1
if existing then
  local decoded = cjson.decode(existing)
  if decoded and decoded.version then
    nextVersion = decoded.version + 1
  end
end
local record = cjson.decode(ARGV[1])
record.version = nextVersion
local encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded)
return encoded
`;

export function createRedisRoutingStore(redisUrl: string): RoutingStore {
  async function getRecord(hostname: string): Promise<RoutingRecord | null> {
    const client = await getRedisClient(redisUrl);
    const raw = await client.get(routingKey(hostname));
    if (!raw) return null;
    return cloneRecord(JSON.parse(raw) as RoutingRecord);
  }

  // The record we pass to the Lua script intentionally omits `version`; the
  // script assigns the authoritative bumped version server-side so concurrent
  // callers cannot collide.
  async function putWithAtomicVersion(
    hostname: string,
    record: Omit<RoutingRecord, "version">,
  ): Promise<RoutingRecord> {
    const client = await getRedisClient(redisUrl);
    const stored = await client.eval(ROUTING_PUT_SCRIPT, {
      keys: [routingKey(hostname)],
      arguments: [JSON.stringify(record)],
    }) as string;
    return JSON.parse(stored) as RoutingRecord;
  }

  return {
    getRecord,
    async putRecord(
      hostname: string,
      target: RoutingTarget,
      updatedAt: number,
    ): Promise<RoutingRecord> {
      return putWithAtomicVersion(hostname, {
        hostname: normalizeHostname(hostname),
        target,
        updatedAt,
      });
    },
    async deleteRecord(
      hostname: string,
      tombstoneTtlMs: number,
      updatedAt: number,
    ): Promise<RoutingRecord> {
      return putWithAtomicVersion(hostname, {
        hostname: normalizeHostname(hostname),
        target: null,
        updatedAt,
        tombstoneUntil: updatedAt + tombstoneTtlMs,
      });
    },
  };
}
