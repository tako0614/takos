import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

import { GitPushLockDO } from "@/durable-objects/git-push-lock";
import {
  createMockState,
  createMockStorage,
  jsonBody,
  postJSON,
} from "./test-helpers.ts";

function createDO() {
  const currentStorage = createMockStorage();
  const currentState = createMockState(currentStorage);
  return {
    storage: currentStorage,
    state: currentState,
    instance: new GitPushLockDO(currentState as unknown as DurableObjectState),
  };
}

Deno.test("GitPushLockDO rejects non-POST methods", async () => {
  const { instance } = createDO();

  const response = await instance.fetch(
    new Request("https://do.internal/acquire", { method: "GET" }),
  );

  assertEquals(response.status, 405);
  assertEquals(await jsonBody(response), { error: "Method not allowed" });
});

Deno.test("GitPushLockDO acquires a lock and schedules an alarm", async () => {
  const { instance, storage, state } = createDO();

  const response = await instance.fetch(postJSON("/acquire", { token: "abc" }));
  const body = await jsonBody(response);

  assertEquals(response.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.token, "abc");
  assertEquals(storage.put.calls.length, 1);
  assertEquals(storage.put.calls[0]?.args[0], "lock");
  assertEquals(storage.setAlarm.calls.length, 1);
  assertEquals(state.blockConcurrencyWhileCalls, 1);
});

Deno.test("GitPushLockDO returns 409 when an active lock already exists", async () => {
  const { instance } = createDO();

  await instance.fetch(postJSON("/acquire", { token: "first" }));
  const conflict = await instance.fetch(
    postJSON("/acquire", { token: "second" }),
  );
  const body = await jsonBody(conflict);

  assertEquals(conflict.status, 409);
  assertEquals(body.ok, false);
  assertStringIncludes(String(body.error ?? ""), "push already in progress");
});

Deno.test("GitPushLockDO releases a matching lock", async () => {
  const { instance, storage } = createDO();

  await instance.fetch(postJSON("/acquire", { token: "mytoken" }));
  const response = await instance.fetch(
    postJSON("/release", { token: "mytoken" }),
  );
  const body = await jsonBody(response);

  assertEquals(response.status, 200);
  assertEquals(body, { ok: true, released: true });
  assertEquals(storage.delete.calls.map((call: { args: unknown[] }) => call.args[0]), ["lock"]);
  assertEquals(storage.deleteAlarm.calls.length, 1);
});

Deno.test("GitPushLockDO rejects release requests without a token", async () => {
  const { instance } = createDO();

  const response = await instance.fetch(postJSON("/release", {}));

  assertEquals(response.status, 400);
  assertEquals(await jsonBody(response), { error: "token is required" });
});

Deno.test("GitPushLockDO rejects release requests with the wrong token", async () => {
  const { instance } = createDO();

  await instance.fetch(postJSON("/acquire", { token: "correct" }));
  const response = await instance.fetch(
    postJSON("/release", { token: "wrong" }),
  );

  assertEquals(response.status, 409);
  assertEquals(await jsonBody(response), { error: "lock token mismatch" });
});

Deno.test("GitPushLockDO alarm clears expired locks", async () => {
  const { instance, storage } = createDO();
  storage._store.set("lock", {
    token: "expired",
    expiresAt: Date.now() - 1000,
  });

  await instance.alarm();

  assertEquals(storage.delete.calls.map((call: { args: unknown[] }) => call.args[0]), ["lock"]);
});

Deno.test("GitPushLockDO alarm reschedules active locks", async () => {
  const { instance, storage } = createDO();
  const futureExpiry = Date.now() + 60_000;
  storage._store.set("lock", { token: "active", expiresAt: futureExpiry });

  await instance.alarm();

  assertEquals(storage.delete.calls.length, 0);
  assertEquals(storage.setAlarm.calls.map((call: { args: unknown[] }) => call.args[0]), [
    futureExpiry,
  ]);
  assert(storage._getAlarm() === futureExpiry);
});
