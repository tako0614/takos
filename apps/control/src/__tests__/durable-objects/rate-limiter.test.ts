// deno-lint-ignore-file no-import-prefix no-unversioned-import
import type { DurableObjectState } from "@cloudflare/workers-types";
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { RateLimiterDO } from "../../../../../packages/control/src/runtime/durable-objects/rate-limiter.ts";

type StoredData = {
  entries?: Record<string, { timestamps: number[] }>;
  tokenBuckets?: Record<string, unknown>;
};

function makeRequest(path: string, body: unknown): Request {
  return new Request(`https://do.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createStorage(initialAlarm: number | null = Date.now() + 60_000) {
  const store = new Map<string, unknown>();
  const state = {
    store,
    alarm: initialAlarm,
    putCalls: [] as Array<[string, unknown]>,
    getCalls: [] as Array<[string]>,
    deleteCalls: [] as Array<[string]>,
    setAlarmCalls: [] as Array<[number]>,
    deleteAlarmCalls: 0,
    getAlarmCalls: 0,
    get<T>(key: string): Promise<T | undefined> {
      state.getCalls.push([key]);
      return Promise.resolve(store.get(key) as T | undefined);
    },
    put(key: string, value: unknown): Promise<void> {
      state.putCalls.push([key, value]);
      store.set(key, value);
      return Promise.resolve();
    },
    delete(key: string): Promise<boolean> {
      state.deleteCalls.push([key]);
      return Promise.resolve(store.delete(key));
    },
    setAlarm(ms: number): Promise<void> {
      state.setAlarmCalls.push([ms]);
      state.alarm = ms;
      return Promise.resolve();
    },
    deleteAlarm(): Promise<void> {
      state.deleteAlarmCalls++;
      state.alarm = null;
      return Promise.resolve();
    },
    getAlarm(): Promise<number | null> {
      state.getAlarmCalls++;
      return Promise.resolve(state.alarm);
    },
  };
  return state;
}

function createDo(
  initialAlarm: number | null = Date.now() + 60_000,
  stored?: StoredData,
) {
  const storage = createStorage(initialAlarm);
  if (stored) {
    storage.store.set("data", stored);
  }

  const state = {
    storage,
    blockConcurrencyCalls: 0,
    async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      state.blockConcurrencyCalls++;
      return await fn();
    },
  };

  const doInstance = new RateLimiterDO(state as unknown as DurableObjectState);

  return { doInstance, state, storage };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("RateLimiterDO - returns 404 for unknown paths", async () => {
  const { doInstance } = createDo();
  await flushMicrotasks();

  const response = await doInstance.fetch(
    new Request("https://do.internal/unknown", { method: "POST" }),
  );
  assertEquals(response.status, 404);
});

Deno.test("RateLimiterDO - sliding_window hit persists allowed requests", async () => {
  const { doInstance, storage, state } = createDo();
  await flushMicrotasks();

  const response = await doInstance.fetch(makeRequest("/hit", {
    key: "user:1",
    maxRequests: 2,
    windowMs: 60_000,
  }));
  const body = await readBody(response);

  assertEquals(body.algorithm, "sliding_window");
  assertEquals(body.allowed, true);
  assertEquals(body.remaining, 1);
  assertEquals(storage.putCalls.length, 1);
  assertEquals(state.blockConcurrencyCalls, 2);
  assertStringIncludes(JSON.stringify(storage.store.get("data")), "user:1");
});

Deno.test("RateLimiterDO - sliding_window hit denies after the limit and does not persist", async () => {
  const { doInstance, storage } = createDo();
  await flushMicrotasks();

  await doInstance.fetch(makeRequest("/hit", {
    key: "user:2",
    maxRequests: 1,
    windowMs: 60_000,
  }));
  const denied = await doInstance.fetch(makeRequest("/hit", {
    key: "user:2",
    maxRequests: 1,
    windowMs: 60_000,
  }));
  const body = await readBody(denied);

  assertEquals(body.allowed, false);
  assertEquals(body.remaining, 0);
  assertEquals(storage.putCalls.length, 1);
});

Deno.test("RateLimiterDO - token_bucket hit persists and reports token_bucket algorithm", async () => {
  const { doInstance, storage } = createDo();
  await flushMicrotasks();

  const response = await doInstance.fetch(makeRequest("/hit", {
    key: "bucket:1",
    maxRequests: 3,
    windowMs: 60_000,
    algorithm: "token_bucket",
  }));
  const body = await readBody(response);

  assertEquals(body.algorithm, "token_bucket");
  assertEquals(body.allowed, true);
  assertEquals(body.remaining, 2);
  assertEquals(storage.putCalls.length, 1);
});

Deno.test("RateLimiterDO - shadow hit returns both sliding_window and token_bucket results", async () => {
  const { doInstance } = createDo();
  await flushMicrotasks();

  const response = await doInstance.fetch(makeRequest("/hit", {
    key: "shadow:1",
    maxRequests: 2,
    windowMs: 60_000,
    algorithm: "shadow",
  }));
  const body = await readBody(response);

  assertEquals(body.algorithm, "sliding_window");
  assertEquals(body.allowed, true);
  assert(body.shadow !== undefined);
  const shadow = body.shadow as Record<string, Record<string, unknown>>;
  assertEquals(shadow.token_bucket.allowed, true);
});

Deno.test("RateLimiterDO - reset clears both storage maps and persists", async () => {
  const { doInstance, storage } = createDo();
  await flushMicrotasks();

  await doInstance.fetch(makeRequest("/hit", {
    key: "reset:key",
    maxRequests: 2,
    windowMs: 60_000,
  }));
  const response = await doInstance.fetch(
    makeRequest("/reset", { key: "reset:key" }),
  );
  const body = await readBody(response);

  assertEquals(body.success, true);
  const persisted = storage.store.get("data") as StoredData;
  assertEquals(persisted.entries?.["reset:key"], undefined);
  assertEquals(persisted.tokenBuckets?.["reset:key"], undefined);
  assert(storage.putCalls.length >= 2);
});

Deno.test("RateLimiterDO - alarm removes expired entries and reschedules when state remains", async () => {
  const { doInstance, storage } = createDo(null);
  await flushMicrotasks();

  const entries =
    (doInstance as unknown as { entries: Map<string, number[]> }).entries;
  entries.set("expired", [Date.now() - 120_000]);
  entries.set("fresh", [Date.now()]);

  await doInstance.alarm();

  assertEquals(entries.has("expired"), false);
  assertEquals(entries.has("fresh"), true);
  assert(storage.putCalls.length > 0);
  assert(storage.setAlarmCalls.length > 0);
});

Deno.test("RateLimiterDO - constructor hydrates stored state", async () => {
  const now = Date.now();
  const { doInstance } = createDo(
    Date.now() + 60_000,
    {
      entries: {
        hydrated: { timestamps: [now] },
      },
      tokenBuckets: {
        hydratedBucket: {
          tokens: 2,
          lastRefill: now,
        },
      },
    },
  );
  await flushMicrotasks();

  const response = await doInstance.fetch(makeRequest("/check", {
    key: "hydrated",
    maxRequests: 10,
    windowMs: 60_000,
  }));
  const body = await readBody(response);

  assertEquals(body.allowed, true);
  assertEquals(body.remaining, 9);
});

Deno.test("RateLimiterDO - blockConcurrencyWhile wraps mutating requests", async () => {
  const { doInstance, state } = createDo();
  await flushMicrotasks();

  await doInstance.fetch(makeRequest("/hit", {
    key: "serialize",
    maxRequests: 2,
    windowMs: 60_000,
  }));

  assertEquals(state.blockConcurrencyCalls, 2);
});
