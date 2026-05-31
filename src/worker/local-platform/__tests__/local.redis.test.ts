import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import { test } from "bun:test";
import { assert, assertEquals } from "@std/assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNodeWebEnv,
  disposeNodePlatformState,
} from "../../node-platform/env-builder.ts";
import {
  resetRedisClientForTests,
  setRedisClientFactoryForTests,
} from "../redis-bindings.ts";
import type { RoutingTarget } from "../../application/services/routing/routing-models.ts";

type Store = {
  lists: Map<string, string[]>;
  strings: Map<string, string>;
};

const stores = new Map<string, Store>();
const calls: Array<{ url: string }> = [];

function getStore(url: string): Store {
  const existing = stores.get(url);
  if (existing) {
    return existing;
  }

  const next: Store = {
    lists: new Map(),
    strings: new Map(),
  };
  stores.set(url, next);
  return next;
}

function installRedisMock(): void {
  setRedisClientFactoryForTests(
    ((options: { url: string }) => {
      calls.push({ url: options.url });
      const store = getStore(options.url);

      return {
        async connect() {
          return this;
        },
        async get(key: string) {
          return store.strings.get(key) ?? null;
        },
        async set(key: string, value: string) {
          store.strings.set(key, value);
          return "OK";
        },
        // Minimal emulation of the atomic routing PUT Lua script: read the
        // existing record, bump version, store, return the stored JSON. Single
        // mock client => execution is already serialized, matching Redis's
        // atomic EVAL semantics.
        // deno-lint-ignore require-await
        async eval(
          _script: string,
          options: { keys: string[]; arguments: string[] },
        ) {
          const key = options.keys[0];
          const existing = store.strings.get(key);
          let nextVersion = 1;
          if (existing) {
            const decoded = JSON.parse(existing) as { version?: number };
            if (typeof decoded.version === "number") {
              nextVersion = decoded.version + 1;
            }
          }
          const record = JSON.parse(options.arguments[0]) as Record<
            string,
            unknown
          >;
          record.version = nextVersion;
          const encoded = JSON.stringify(record);
          store.strings.set(key, encoded);
          return encoded;
        },
        async lRange(key: string, start: number, end: number) {
          const list = store.lists.get(key) ?? [];
          const effectiveEnd = end < 0 ? list.length - 1 : end;
          return list.slice(start, effectiveEnd + 1);
        },
        async lPop(key: string) {
          const list = store.lists.get(key) ?? [];
          const value = list.shift() ?? null;
          store.lists.set(key, list);
          return value;
        },
        async rPush(key: string, ...values: string[]) {
          const list = store.lists.get(key) ?? [];
          list.push(...values);
          store.lists.set(key, list);
          return list.length;
        },
        async close() {
          return;
        },
        destroy() {
          return;
        },
      };
    }) as typeof import("redis").createClient,
  );
}

test("local redis-backed bindings - uses redis for local message queue and routing persistence when REDIS_URL is set", async () => {
  const originalRedisUrl = getEnv("REDIS_URL");
  const originalDisableRedisExternals = getEnv(
    "TAKOS_DISABLE_REDIS_EXTERNALS",
  );
  const originalLocalDataDir = getEnv("TAKOS_LOCAL_DATA_DIR");
  const tempLocalDataDir = await mkdtemp(join(tmpdir(), "takos-local-redis-"));
  setEnv("REDIS_URL", "redis://localhost:6379");
  setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", "1");
  setEnv("TAKOS_LOCAL_DATA_DIR", tempLocalDataDir);
  calls.length = 0;
  stores.clear();
  installRedisMock();
  await disposeNodePlatformState();

  try {
    const env = await createNodeWebEnv();
    const target: RoutingTarget = {
      type: "deployments",
      deployments: [{ routeRef: "tenant-app", weight: 100, status: "active" }],
    };

    await env.RUN_QUEUE.send({
      version: 2,
      runId: "run-redis",
      timestamp: 1710000000000,
      model: "gpt-5-mini",
    });
    await env.ROUTING_STORE!.putRecord("Redis.Example", target, 1710000001234);

    assert(calls.length >= 1);
    assertEquals(
      calls.some((item) => item.url === "redis://localhost:6379"),
      true,
    );

    const store = stores.get("redis://localhost:6379");
    assert(store !== undefined);
    assertEquals(store.lists.get("takos:local:queue:takos-runs"), [
      JSON.stringify({
        body: {
          version: 2,
          runId: "run-redis",
          timestamp: 1710000000000,
          model: "gpt-5-mini",
        },
      }),
    ]);
    assertEquals(
      JSON.parse(store.strings.get("takos:local:routing:redis.example")!),
      {
        hostname: "redis.example",
        target,
        version: 1,
        updatedAt: 1710000001234,
      },
    );

    assertEquals(await env.ROUTING_STORE!.getRecord("redis.example"), {
      hostname: "redis.example",
      target,
      version: 1,
      updatedAt: 1710000001234,
    });
  } finally {
    if (originalRedisUrl === undefined) {
      deleteEnv("REDIS_URL");
    } else {
      setEnv("REDIS_URL", originalRedisUrl);
    }
    if (originalDisableRedisExternals === undefined) {
      deleteEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
    } else {
      setEnv(
        "TAKOS_DISABLE_REDIS_EXTERNALS",
        originalDisableRedisExternals,
      );
    }
    if (originalLocalDataDir === undefined) {
      deleteEnv("TAKOS_LOCAL_DATA_DIR");
    } else {
      setEnv("TAKOS_LOCAL_DATA_DIR", originalLocalDataDir);
    }
    setRedisClientFactoryForTests(null);
    resetRedisClientForTests();
    await disposeNodePlatformState();
    await rm(tempLocalDataDir, { recursive: true, force: true });
  }
});
