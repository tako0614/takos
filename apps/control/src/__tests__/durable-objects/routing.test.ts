import { RoutingDO } from "@/durable-objects/routing";
import type { RoutingTarget } from "@/services/routing/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
import { spy } from "jsr:@std/testing/mock";

function createMockStorage() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    get: async <T>(key: string): Promise<T | undefined> =>
      store.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    delete: spy(async (key: string) => {
      store.delete(key);
      return true;
    }),
    setAlarm: async (ms: number) => {
      alarm = ms;
    },
    deleteAlarm: spy(async () => {
      alarm = null;
    }),
    getAlarm: async () => alarm,
    list: async (_opts?: { prefix?: string; limit?: number }) => {
      const result = new Map<string, unknown>();
      for (const [key, value] of store) {
        if (_opts?.prefix && !key.startsWith(_opts.prefix)) continue;
        result.set(key, value);
        if (_opts?.limit && result.size >= _opts.limit) break;
      }
      return result;
    },
    _store: store,
    _getAlarm: () => alarm,
  };
}

function createMockState(storage = createMockStorage()) {
  return {
    storage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  };
}

function createDO(stateOverrides?: ReturnType<typeof createMockState>) {
  const state = stateOverrides ?? createMockState();
  const doInstance = new RoutingDO(state as unknown as DurableObjectState);
  return { doInstance, state };
}

function postJSON(path: string, body: unknown): Request {
  return new Request(`https://do.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

const validTarget: RoutingTarget = {
  type: "deployments",
  deployments: [{ routeRef: "worker-abc", weight: 100 }],
};

const validHttpTarget: RoutingTarget = {
  type: "http-endpoint-set",
  endpoints: [{
    name: "api",
    routes: [{ pathPrefix: "/" }],
    target: { kind: "http-url", baseUrl: "https://example.com" },
  }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("RoutingDO - fetch routing - returns 404 for unknown paths", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/unknown", {}));
  assertEquals(res.status, 404);
});
Deno.test("RoutingDO - fetch routing - returns 500 for server errors", async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
  // Force the get to throw inside handleGet
  storage.get = (async () => {
    throw new Error("boom");
  }) as any;
  const state = createMockState(storage);
  const { doInstance } = createDO(state);

  const res = await doInstance.fetch(
    postJSON("/routing/get", { hostname: "example.com" }),
  );
  assertEquals(res.status, 500);
});

Deno.test("RoutingDO - /routing/get - returns null for non-existent hostname", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(
    postJSON("/routing/get", { hostname: "test.example.com" }),
  );
  assertEquals(res.status, 200);

  const body = await jsonBody(res);
  assertEquals(body.record, null);
});
Deno.test("RoutingDO - /routing/get - returns a stored routing record", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  // Put a record first
  await doInstance.fetch(postJSON("/routing/put", {
    hostname: "app.takos.jp",
    target: validTarget,
  }));

  // Get it back
  const res = await doInstance.fetch(
    postJSON("/routing/get", { hostname: "app.takos.jp" }),
  );
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertNotEquals(record, null);
  assertEquals(record.hostname, "app.takos.jp");
  assertEquals(record.version, 1);
});
Deno.test("RoutingDO - /routing/get - normalizes hostname to lowercase", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  await doInstance.fetch(postJSON("/routing/put", {
    hostname: "APP.TAKOS.JP",
    target: validTarget,
  }));

  const res = await doInstance.fetch(
    postJSON("/routing/get", { hostname: "app.takos.jp" }),
  );
  const body = await jsonBody(res);
  assertNotEquals(body.record, null);
});
Deno.test("RoutingDO - /routing/get - returns null for invalid hostname", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(
    postJSON("/routing/get", { hostname: "" }),
  );
  const body = await jsonBody(res);
  assertEquals(body.record, null);
});
Deno.test("RoutingDO - /routing/get - cleans up expired tombstones on get", async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
  const state = createMockState(storage);
  const { doInstance } = createDO(state);

  // Manually set a record with an expired tombstone
  const hostname = "expired.test.com";
  const expiredTombstone = Date.now() - 1000;
  storage._store.set(`r:${hostname}`, {
    target: null,
    version: 1,
    updatedAt: Date.now() - 5000,
    tombstoneUntil: expiredTombstone,
  });

  // Also add tombstone index entry
  const hex = Math.floor(expiredTombstone).toString(16).padStart(16, "0");
  storage._store.set(`t:${hex}:${hostname}`, 1);

  const res = await doInstance.fetch(postJSON("/routing/get", { hostname }));
  const body = await jsonBody(res);
  // Should be cleaned up and return null
  assertEquals(body.record, null);
});
Deno.test("RoutingDO - /routing/get - returns record with active tombstone", async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
  const state = createMockState(storage);
  const { doInstance } = createDO(state);

  const hostname = "active-tombstone.test.com";
  const futureTombstone = Date.now() + 60000;
  storage._store.set(`r:${hostname}`, {
    target: null,
    version: 1,
    updatedAt: Date.now(),
    tombstoneUntil: futureTombstone,
  });

  const res = await doInstance.fetch(postJSON("/routing/get", { hostname }));
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertNotEquals(record, null);
  assertEquals(record.tombstoneUntil, futureTombstone);
});

Deno.test("RoutingDO - /routing/put - creates a new routing record", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "new.example.com",
    target: validTarget,
  }));
  assertEquals(res.status, 200);

  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertEquals(record.hostname, "new.example.com");
  assertEquals(record.version, 1);
  assertEquals(record.target, validTarget);
});
Deno.test("RoutingDO - /routing/put - increments version on update", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  await doInstance.fetch(postJSON("/routing/put", {
    hostname: "versioned.com",
    target: validTarget,
  }));

  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "versioned.com",
    target: validHttpTarget,
  }));
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertEquals(record.version, 2);
});
Deno.test("RoutingDO - /routing/put - returns 400 for invalid hostname", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "",
    target: validTarget,
  }));
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - /routing/put - returns 400 for invalid target", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "test.com",
    target: { type: "invalid" },
  }));
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - /routing/put - returns 400 for deployments target with empty routeRef", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "test.com",
    target: {
      type: "deployments",
      deployments: [{ routeRef: "", weight: 100 }],
    },
  }));
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - /routing/put - returns 400 for deployments target with no deployments", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "test.com",
    target: { type: "deployments", deployments: [] },
  }));
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - /routing/put - accepts http-endpoint-set target", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "http-target.com",
    target: validHttpTarget,
  }));
  assertEquals(res.status, 200);
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertEquals((record.target as RoutingTarget).type, "http-endpoint-set");
});
Deno.test("RoutingDO - /routing/put - uses provided updatedAt if valid", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const customTime = 1700000000000;
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "timed.com",
    target: validTarget,
    updatedAt: customTime,
  }));
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertEquals(record.updatedAt, customTime);
});
Deno.test("RoutingDO - /routing/put - clears previous tombstone index on update", async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
  const state = createMockState(storage);
  const { doInstance } = createDO(state);

  // Delete to create a tombstone
  await doInstance.fetch(postJSON("/routing/put", {
    hostname: "tombstone-clear.com",
    target: validTarget,
  }));
  await doInstance.fetch(postJSON("/routing/delete", {
    hostname: "tombstone-clear.com",
  }));

  // Now put again - should clear the tombstone index
  const deleteCalls = storage.delete.calls.length;
  await doInstance.fetch(postJSON("/routing/put", {
    hostname: "tombstone-clear.com",
    target: validTarget,
  }));
  // At least one delete call for the tombstone index
  assert(storage.delete.calls.length > deleteCalls);
});

Deno.test("RoutingDO - /routing/delete - creates a tombstone for an existing record", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  await doInstance.fetch(postJSON("/routing/put", {
    hostname: "delete-me.com",
    target: validTarget,
  }));

  const res = await doInstance.fetch(postJSON("/routing/delete", {
    hostname: "delete-me.com",
  }));
  assertEquals(res.status, 200);

  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertEquals(record.target, null);
  assertEquals(typeof record.tombstoneUntil, "number");
  assertEquals(record.version, 2);
});
Deno.test("RoutingDO - /routing/delete - creates tombstone even when no previous record exists", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/delete", {
    hostname: "no-previous.com",
  }));
  assertEquals(res.status, 200);

  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertEquals(record.target, null);
  assertEquals(record.version, 1);
  assertEquals(typeof record.tombstoneUntil, "number");
});
Deno.test("RoutingDO - /routing/delete - returns 400 for invalid hostname", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(
    postJSON("/routing/delete", { hostname: "" }),
  );
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - /routing/delete - clamps tombstoneTtlMs to minimum of 1s", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const now = Date.now();
  const res = await doInstance.fetch(postJSON("/routing/delete", {
    hostname: "min-ttl.com",
    tombstoneTtlMs: 100,
  }));
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  // tombstoneUntil should be at least now + 1000 (1 second minimum)
  assert(record.tombstoneUntil as number >= now + 1000);
});
Deno.test("RoutingDO - /routing/delete - clamps tombstoneTtlMs to maximum of 30 minutes", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const now = Date.now();
  const thirtyMinMs = 30 * 60 * 1000;
  const res = await doInstance.fetch(postJSON("/routing/delete", {
    hostname: "max-ttl.com",
    tombstoneTtlMs: 60 * 60 * 1000, // 1 hour - should be clamped
  }));
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assert(record.tombstoneUntil as number <= now + thirtyMinMs + 100);
});
Deno.test("RoutingDO - /routing/delete - defaults tombstoneTtlMs to 2 minutes when not specified", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const now = Date.now();
  const res = await doInstance.fetch(postJSON("/routing/delete", {
    hostname: "default-ttl.com",
  }));
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  const expected = now + 2 * 60_000;
  // Within a few ms of expected
  assert(Math.abs((record.tombstoneUntil as number) - expected) < 100);
});

Deno.test("RoutingDO - hostname normalization - trims whitespace", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "  test.com  ",
    target: validTarget,
  }));
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertEquals(record.hostname, "test.com");
});
Deno.test("RoutingDO - hostname normalization - converts to lowercase", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "TEST.EXAMPLE.COM",
    target: validTarget,
  }));
  const body = await jsonBody(res);
  const record = body.record as Record<string, unknown>;
  assertEquals(record.hostname, "test.example.com");
});
Deno.test("RoutingDO - hostname normalization - rejects hostname longer than 253 characters", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const longHostname = "a".repeat(64) + "." + "b".repeat(64) + "." +
    "c".repeat(64) + "." + "d".repeat(64);
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: longHostname,
    target: validTarget,
  }));
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - hostname normalization - rejects label longer than 63 characters", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "a".repeat(64) + ".com",
    target: validTarget,
  }));
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - hostname normalization - rejects hostname with leading hyphen in label", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "-invalid.com",
    target: validTarget,
  }));
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - hostname normalization - rejects hostname with trailing hyphen in label", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "invalid-.com",
    target: validTarget,
  }));
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - hostname normalization - rejects hostname with invalid characters", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "inv@lid.com",
    target: validTarget,
  }));
  assertEquals(res.status, 400);
});
Deno.test("RoutingDO - hostname normalization - allows hyphens in the middle of labels", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "my-app.test-site.com",
    target: validTarget,
  }));
  assertEquals(res.status, 200);
});
Deno.test("RoutingDO - hostname normalization - allows numeric labels", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "123.456.com",
    target: validTarget,
  }));
  assertEquals(res.status, 200);
});
Deno.test("RoutingDO - hostname normalization - rejects empty label (double dots)", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "test..com",
    target: validTarget,
  }));
  assertEquals(res.status, 400);
});

Deno.test("RoutingDO - alarm (tombstone cleanup) - cleans up expired tombstones via alarm", async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
  const state = createMockState(storage);
  const { doInstance } = createDO(state);

  // Insert an expired tombstone
  const hostname = "expired.com";
  const expiredMs = Date.now() - 5000;
  const hex = Math.floor(expiredMs).toString(16).padStart(16, "0");
  storage._store.set(`r:${hostname}`, {
    target: null,
    version: 1,
    updatedAt: Date.now() - 10000,
    tombstoneUntil: expiredMs,
  });
  storage._store.set(`t:${hex}:${hostname}`, 1);

  await doInstance.alarm();

  // Both the route record and tombstone index should be cleaned up
  assertEquals(storage._store.has(`r:${hostname}`), false);
  assertEquals(storage._store.has(`t:${hex}:${hostname}`), false);
});
Deno.test("RoutingDO - alarm (tombstone cleanup) - does not clean up future tombstones", async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
  const state = createMockState(storage);
  const { doInstance } = createDO(state);

  const hostname = "future.com";
  const futureMs = Date.now() + 60000;
  const hex = Math.floor(futureMs).toString(16).padStart(16, "0");
  storage._store.set(`r:${hostname}`, {
    target: null,
    version: 1,
    updatedAt: Date.now(),
    tombstoneUntil: futureMs,
  });
  storage._store.set(`t:${hex}:${hostname}`, 1);

  await doInstance.alarm();

  assertEquals(storage._store.has(`r:${hostname}`), true);
});

Deno.test("RoutingDO - scheduleNextCleanupAlarm - deletes alarm when no tombstones exist", async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
  const state = createMockState(storage);
  const { doInstance } = createDO(state);

  // Put and get to trigger scheduleNextCleanupAlarm internally
  const res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "alarm-test.com",
    target: validTarget,
  }));
  assertEquals(res.status, 200);

  // Should delete alarm since there are no tombstones
  // (list returns empty for tombstone prefix)
  assert(storage.deleteAlarm.calls.length > 0);
});

Deno.test("RoutingDO - end-to-end lifecycle - put -> get -> delete -> get (tombstone) -> alarm -> get (gone)", async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
  const state = createMockState(storage);
  const { doInstance } = createDO(state);

  // Put
  let res = await doInstance.fetch(postJSON("/routing/put", {
    hostname: "lifecycle.com",
    target: validTarget,
  }));
  let body = await jsonBody(res);
  assertEquals((body.record as Record<string, unknown>).version, 1);

  // Get
  res = await doInstance.fetch(
    postJSON("/routing/get", { hostname: "lifecycle.com" }),
  );
  body = await jsonBody(res);
  assertNotEquals(body.record, null);

  // Delete with very short TTL
  res = await doInstance.fetch(postJSON("/routing/delete", {
    hostname: "lifecycle.com",
    tombstoneTtlMs: 1000, // 1 second (minimum)
  }));
  body = await jsonBody(res);
  assertEquals((body.record as Record<string, unknown>).target, null);
  assertEquals((body.record as Record<string, unknown>).version, 2);

  // Get returns the tombstoned record (still within TTL)
  res = await doInstance.fetch(
    postJSON("/routing/get", { hostname: "lifecycle.com" }),
  );
  body = await jsonBody(res);
  assertNotEquals(body.record, null);

  // Simulate time passing past tombstone expiry by modifying storage directly
  const routeRecord = storage._store.get("r:lifecycle.com") as Record<
    string,
    unknown
  >;
  routeRecord.tombstoneUntil = Date.now() - 1000;
  // Also update the tombstone index to be expired
  for (const key of Array.from(storage._store.keys())) {
    if (key.startsWith("t:") && key.endsWith(":lifecycle.com")) {
      storage._store.delete(key);
      const expiredHex = Math.floor(Date.now() - 1000).toString(16).padStart(
        16,
        "0",
      );
      storage._store.set(`t:${expiredHex}:lifecycle.com`, 1);
    }
  }

  // Get now should return null (expired tombstone cleaned up on access)
  res = await doInstance.fetch(
    postJSON("/routing/get", { hostname: "lifecycle.com" }),
  );
  body = await jsonBody(res);
  assertEquals(body.record, null);
});
