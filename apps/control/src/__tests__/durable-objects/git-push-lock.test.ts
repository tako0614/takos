import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

import { GitPushLockDO } from "@/durable-objects/git-push-lock";

function createMockStorage() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    putCalls: [] as Array<[string, unknown]>,
    deleteCalls: [] as string[],
    setAlarmCalls: [] as number[],
    deleteAlarmCalls: 0,
    get: async <T>(key: string): Promise<T | undefined> =>
      store.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      store.set(key, value);
      storage.putCalls.push([key, value]);
    },
    delete: async (key: string) => {
      store.delete(key);
      storage.deleteCalls.push(key);
      return true;
    },
    setAlarm: async (ms: number) => {
      alarm = ms;
      storage.setAlarmCalls.push(ms);
    },
    deleteAlarm: async () => {
      alarm = null;
      storage.deleteAlarmCalls += 1;
    },
    getAlarm: async () => alarm,
    list: async () => new Map(),
    _store: store,
    _getAlarm: () => alarm,
  };
  return storage;
}

function createMockState(storage = createMockStorage()) {
  const state = {
    storage,
    blockConcurrencyWhileCalls: 0,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => {
      state.blockConcurrencyWhileCalls += 1;
      return await fn();
    },
  };
  return state;
}

function createDO() {
  const currentStorage = createMockStorage();
  const currentState = createMockState(currentStorage);
  return {
    storage: currentStorage,
    state: currentState,
    instance: new GitPushLockDO(currentState as unknown as DurableObjectState),
  };
}

function postJson(path: string, body: Record<string, unknown> = {}): Request {
  return new Request(`https://do.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("GitPushLockDO rejects non-POST methods", async () => {
  const { instance } = createDO();

  const response = await instance.fetch(
    new Request("https://do.internal/acquire", { method: "GET" }),
  );

  assertEquals(response.status, 405);
  assertEquals(await readJson(response), { error: "Method not allowed" });
});

Deno.test("GitPushLockDO acquires a lock and schedules an alarm", async () => {
  const { instance, storage, state } = createDO();

  const response = await instance.fetch(postJson("/acquire", { token: "abc" }));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.token, "abc");
  assertEquals(storage.putCalls.length, 1);
  assertEquals(storage.putCalls[0]?.[0], "lock");
  assertEquals(storage.setAlarmCalls.length, 1);
  assertEquals(state.blockConcurrencyWhileCalls, 1);
});

Deno.test("GitPushLockDO returns 409 when an active lock already exists", async () => {
  const { instance } = createDO();

  await instance.fetch(postJson("/acquire", { token: "first" }));
  const conflict = await instance.fetch(
    postJson("/acquire", { token: "second" }),
  );
  const body = await readJson(conflict);

  assertEquals(conflict.status, 409);
  assertEquals(body.ok, false);
  assertStringIncludes(String(body.error ?? ""), "push already in progress");
});

Deno.test("GitPushLockDO releases a matching lock", async () => {
  const { instance, storage } = createDO();

  await instance.fetch(postJson("/acquire", { token: "mytoken" }));
  const response = await instance.fetch(
    postJson("/release", { token: "mytoken" }),
  );
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body, { ok: true, released: true });
  assertEquals(storage.deleteCalls, ["lock"]);
  assertEquals(storage.deleteAlarmCalls, 1);
});

Deno.test("GitPushLockDO rejects release requests without a token", async () => {
  const { instance } = createDO();

  const response = await instance.fetch(postJson("/release", {}));

  assertEquals(response.status, 400);
  assertEquals(await readJson(response), { error: "token is required" });
});

Deno.test("GitPushLockDO rejects release requests with the wrong token", async () => {
  const { instance } = createDO();

  await instance.fetch(postJson("/acquire", { token: "correct" }));
  const response = await instance.fetch(
    postJson("/release", { token: "wrong" }),
  );

  assertEquals(response.status, 409);
  assertEquals(await readJson(response), { error: "lock token mismatch" });
});

Deno.test("GitPushLockDO alarm clears expired locks", async () => {
  const { instance, storage } = createDO();
  storage._store.set("lock", {
    token: "expired",
    expiresAt: Date.now() - 1000,
  });

  await instance.alarm();

  assertEquals(storage.deleteCalls, ["lock"]);
});

Deno.test("GitPushLockDO alarm reschedules active locks", async () => {
  const { instance, storage } = createDO();
  const futureExpiry = Date.now() + 60_000;
  storage._store.set("lock", { token: "active", expiresAt: futureExpiry });

  await instance.alarm();

  assertEquals(storage.deleteCalls.length, 0);
  assertEquals(storage.setAlarmCalls, [futureExpiry]);
  assert(storage._getAlarm() === futureExpiry);
});
