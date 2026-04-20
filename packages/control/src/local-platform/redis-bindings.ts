import { createClient } from "redis";
import type {
  RoutingRecord,
  RoutingStore,
  RoutingTarget,
} from "../application/services/routing/routing-models.ts";
import type { QueueBinding } from "../shared/types/bindings.ts";
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
): QueueBinding<T> {
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
      const rawRecord = await client.lPop(queueKey(queueName));
      if (!rawRecord) return null;
      const record = JSON.parse(rawRecord) as QueueRecord<T>;
      const nextIndex = sent.findIndex((item) =>
        JSON.stringify(item) === rawRecord
      );
      if (nextIndex >= 0) {
        sent.splice(nextIndex, 1);
      } else if (sent.length > 0) {
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

export function createRedisRoutingStore(redisUrl: string): RoutingStore {
  async function getRecord(hostname: string): Promise<RoutingRecord | null> {
    const client = await getRedisClient(redisUrl);
    const raw = await client.get(routingKey(hostname));
    if (!raw) return null;
    return cloneRecord(JSON.parse(raw) as RoutingRecord);
  }

  return {
    getRecord,
    async putRecord(
      hostname: string,
      target: RoutingTarget,
      updatedAt: number,
    ): Promise<RoutingRecord> {
      const client = await getRedisClient(redisUrl);
      const current = await getRecord(hostname);
      const next: RoutingRecord = {
        hostname: normalizeHostname(hostname),
        target,
        version: (current?.version ?? 0) + 1,
        updatedAt,
      };
      await client.set(routingKey(hostname), JSON.stringify(next));
      return cloneRecord(next)!;
    },
    async deleteRecord(
      hostname: string,
      tombstoneTtlMs: number,
      updatedAt: number,
    ): Promise<RoutingRecord> {
      const client = await getRedisClient(redisUrl);
      const current = await getRecord(hostname);
      const next: RoutingRecord = {
        hostname: normalizeHostname(hostname),
        target: null,
        version: (current?.version ?? 0) + 1,
        updatedAt,
        tombstoneUntil: updatedAt + tombstoneTtlMs,
      };
      await client.set(routingKey(hostname), JSON.stringify(next));
      return cloneRecord(next)!;
    },
  };
}
