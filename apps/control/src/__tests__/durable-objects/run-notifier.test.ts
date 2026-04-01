import { RunNotifierDO } from "@/durable-objects/run-notifier";

// ---------------------------------------------------------------------------
// Mock the heavy dependencies used in RunNotifierDO
// ---------------------------------------------------------------------------

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
// [Deno] vi.mock removed - manually stub imports from '@/services/offload/run-events'
// [Deno] vi.mock removed - manually stub imports from '@/services/offload/usage-events'
// [Deno] vi.mock removed - manually stub imports from '@/services/run-notifier'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";
import { FakeTime } from "jsr:@std/testing/time";

function createMockStorage() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    get: async <T>(key: string): Promise<T | undefined> =>
      store.get(key) as T | undefined,
    put: spy(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: spy(async (key: string) => {
      store.delete(key);
      return true;
    }),
    setAlarm: spy(async (ms: number) => {
      alarm = ms;
    }),
    deleteAlarm: spy(async () => {
      alarm = null;
    }),
    getAlarm: async () => alarm,
    list: async () => new Map(),
    _store: store,
  };
}

function createMockState(storage = createMockStorage()): any {
  return {
    storage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    acceptWebSocket: ((..._args: any[]) => undefined) as any,
    getWebSockets: () => [],
    getTags: () => [],
  };
}

function createMockEnv() {
  return {
    DB: {} as unknown,
    TAKOS_OFFLOAD: undefined,
  };
}

class MockWebSocket {
  sent: string[] = [];
  closed = false;
  closeCode?: number;
  closeReason?: string;
  connectionId?: string;
  lastActivity?: number;

  send(data: string) {
    if (this.closed) throw new Error("WebSocket closed");
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

function createDO(
  opts: {
    env?: Record<string, unknown>;
    state?: ReturnType<typeof createMockState>;
  } = {},
) {
  const state = opts.state ?? createMockState();
  const env = opts.env ?? createMockEnv();
  const doInstance = new RunNotifierDO(
    state as unknown as DurableObjectState,
    env as never,
  );
  return { doInstance, state };
}

function internalHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "X-Takos-Internal": "1",
    "Content-Type": "application/json",
    ...extra,
  };
}

function postJSON(
  path: string,
  body: unknown,
  headers: Record<string, string> = internalHeaders(),
): Request {
  return new Request(`https://do.internal${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function getRequest(
  path: string,
  headers: Record<string, string> = internalHeaders(),
): Request {
  return new Request(`https://do.internal${path}`, {
    method: "GET",
    headers,
  });
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("RunNotifierDO - fetch routing - returns 401 for non-internal, non-auth requests", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const req = new Request("https://do.internal/emit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 401);
});
Deno.test("RunNotifierDO - fetch routing - allows requests with X-WS-Auth-Validated header", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const req = new Request("https://do.internal/state", {
    method: "GET",
    headers: { "X-WS-Auth-Validated": "true" },
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 200);
});
Deno.test("RunNotifierDO - fetch routing - returns 404 for unknown paths", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(getRequest("/unknown"));
  assertEquals(res.status, 404);
});

Deno.test("RunNotifierDO - /emit - emits an event and returns success", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/emit", {
    type: "message",
    data: { text: "hello" },
  }));
  assertEquals(res.status, 200);

  const body = await jsonBody(res);
  assertEquals(body.success, true);
  assertEquals(body.eventId, 1);
  assertEquals(body.clients, 0);
});
Deno.test("RunNotifierDO - /emit - sets runId from first emit", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  await doInstance.fetch(postJSON("/emit", {
    type: "start",
    data: null,
    runId: "run-123",
  }));

  const stateRes = await doInstance.fetch(getRequest("/state"));
  const body = await jsonBody(stateRes);
  assertEquals(body.runId, "run-123");
});
Deno.test("RunNotifierDO - /emit - does not overwrite existing runId", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  await doInstance.fetch(postJSON("/emit", {
    type: "start",
    data: null,
    runId: "run-first",
  }));
  await doInstance.fetch(postJSON("/emit", {
    type: "update",
    data: null,
    runId: "run-second",
  }));

  const stateRes = await doInstance.fetch(getRequest("/state"));
  const body = await jsonBody(stateRes);
  assertEquals(body.runId, "run-first");
});
Deno.test("RunNotifierDO - /emit - validates runId format", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/emit", {
    type: "test",
    data: null,
    runId: "invalid run id!",
  }));
  assertEquals(res.status, 400);
  const body = await jsonBody(res);
  assertEquals(body.error, "Invalid runId");
});
Deno.test("RunNotifierDO - /emit - validates runId length", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/emit", {
    type: "test",
    data: null,
    runId: "a".repeat(65),
  }));
  assertEquals(res.status, 400);
});
Deno.test("RunNotifierDO - /emit - rejects empty type", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/emit", {
    type: "",
    data: null,
  }));
  assertEquals(res.status, 400);
  const body = await jsonBody(res);
  assertEquals(body.error, "Invalid type");
});
Deno.test("RunNotifierDO - /emit - rejects type longer than 256 chars", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/emit", {
    type: "x".repeat(257),
    data: null,
  }));
  assertEquals(res.status, 400);
});
Deno.test("RunNotifierDO - /emit - rejects data larger than 1MB", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/emit", {
    type: "big",
    data: "x".repeat(1_048_576),
  }));
  assertEquals(res.status, 400);
  const body = await jsonBody(res);
  assertEquals(body.error, "Data too large");
});
Deno.test("RunNotifierDO - /emit - assigns sequential event IDs", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  const r1 = await jsonBody(
    await doInstance.fetch(postJSON("/emit", { type: "a", data: null })),
  );
  const r2 = await jsonBody(
    await doInstance.fetch(postJSON("/emit", { type: "b", data: null })),
  );
  const r3 = await jsonBody(
    await doInstance.fetch(postJSON("/emit", { type: "c", data: null })),
  );

  assertEquals(r1.eventId, 1);
  assertEquals(r2.eventId, 2);
  assertEquals(r3.eventId, 3);
});
Deno.test("RunNotifierDO - /emit - accepts preferred event_id", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const r1 = await jsonBody(
    await doInstance.fetch(postJSON("/emit", {
      type: "a",
      data: null,
      event_id: 50,
    })),
  );
  assertEquals(r1.eventId, 50);
});
Deno.test("RunNotifierDO - /emit - broadcasts to connected WebSocket clients", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";
  ws.lastActivity = Date.now();
  (doInstance as unknown as { connections: Map<string, MockWebSocket> })
    .connections.set("conn-1", ws as unknown as never);

  const res = await doInstance.fetch(
    postJSON("/emit", { type: "test", data: { v: 1 } }),
  );
  const body = await jsonBody(res);
  assertEquals(body.clients, 1);
  assert(ws.sent.length > 0);

  const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
  assertEquals(msg.type, "test");
  assert(msg.event_id !== undefined);
  assert(msg.created_at !== undefined);
});
Deno.test("RunNotifierDO - /emit - removes failed connections during broadcast", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  const ws = new MockWebSocket();
  ws.connectionId = "conn-fail";
  ws.lastActivity = Date.now();
  ws.send = () => {
    throw new Error("dead");
  };
  (doInstance as unknown as { connections: Map<string, MockWebSocket> })
    .connections.set("conn-fail", ws as unknown as never);

  await doInstance.fetch(postJSON("/emit", { type: "test", data: null }));

  const connections =
    (doInstance as unknown as { connections: Map<string, unknown> })
      .connections;
  assertEquals(connections.has("conn-fail"), false);
});
Deno.test("RunNotifierDO - /emit - persists state after emit", async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
  const { doInstance } = createDO({ state });

  await doInstance.fetch(postJSON("/emit", { type: "test", data: null }));

  const persisted = state.storage.put.calls[0].args[1] as Record<
    string,
    unknown
  >;
  assertEquals(persisted.eventIdCounter, 1);
  assertEquals(persisted.runId, null);
  assertEquals(Array.isArray(persisted.eventBuffer), true);
});
Deno.test("RunNotifierDO - /emit - returns 400 for invalid JSON body", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const req = new Request("https://do.internal/emit", {
    method: "POST",
    headers: internalHeaders(),
    body: "not-json",
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 400);
});

Deno.test("RunNotifierDO - /usage - records usage events", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/usage", {
    runId: "run-1",
    meter_type: "input_tokens",
    units: 100,
  }));
  assertEquals(res.status, 200);
  const body = await jsonBody(res);
  assertEquals(body.success, true);
});
Deno.test("RunNotifierDO - /usage - rejects missing meter_type", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/usage", {
    units: 100,
  }));
  const body = await jsonBody(res);
  assertEquals(body.success, false);
  assertEquals(body.error, "meter_type is required");
});
Deno.test("RunNotifierDO - /usage - rejects non-positive units", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/usage", {
    meter_type: "tokens",
    units: 0,
  }));
  const body = await jsonBody(res);
  assertEquals(body.success, false);
  assertEquals(body.error, "units must be positive");
});
Deno.test("RunNotifierDO - /usage - rejects negative units", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/usage", {
    meter_type: "tokens",
    units: -5,
  }));
  const body = await jsonBody(res);
  assertEquals(body.success, false);
});
Deno.test("RunNotifierDO - /usage - rejects NaN units", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const res = await doInstance.fetch(postJSON("/usage", {
    meter_type: "tokens",
    units: "not-a-number",
  }));
  const body = await jsonBody(res);
  assertEquals(body.success, false);
});
Deno.test("RunNotifierDO - /usage - sets runId from usage if not already set", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  await doInstance.fetch(postJSON("/usage", {
    runId: "run-from-usage",
    meter_type: "tokens",
    units: 50,
  }));

  const stateRes = await doInstance.fetch(getRequest("/state"));
  const body = await jsonBody(stateRes);
  assertEquals(body.runId, "run-from-usage");
});
Deno.test("RunNotifierDO - /usage - includes reference_type and metadata", async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
  const { doInstance } = createDO({ state });

  await doInstance.fetch(postJSON("/usage", {
    meter_type: "tokens",
    units: 100,
    reference_type: "prompt",
    metadata: { model: "gpt-4" },
  }));

  // Verify usage was buffered (check via state persist)
  const persisted = state.storage.put.calls[0].args[1] as {
    usageSegmentBuffer?: Array<Record<string, unknown>>;
  };
  assertEquals(persisted.usageSegmentBuffer?.[0]?.meter_type, "tokens");
  assertEquals(persisted.usageSegmentBuffer?.[0]?.units, 100);
  assertEquals(persisted.usageSegmentBuffer?.[0]?.reference_type, "prompt");
  assertEquals(
    persisted.usageSegmentBuffer?.[0]?.metadata,
    '{"model":"gpt-4"}',
  );
});
Deno.test("RunNotifierDO - /usage - returns 400 for invalid JSON body", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const req = new Request("https://do.internal/usage", {
    method: "POST",
    headers: internalHeaders(),
    body: "not-json",
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 400);
});

Deno.test("RunNotifierDO - /events - returns events after a given ID", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  await doInstance.fetch(postJSON("/emit", { type: "a", data: 1 }));
  await doInstance.fetch(postJSON("/emit", { type: "b", data: 2 }));
  await doInstance.fetch(postJSON("/emit", { type: "c", data: 3 }));

  const res = await doInstance.fetch(getRequest("/events?after=1"));
  const body = await jsonBody(res);
  const events = body.events as Array<{ type: string }>;
  assertEquals(events.length, 2);
  assertEquals(events[0].type, "b");
  assertEquals(events[1].type, "c");
});
Deno.test("RunNotifierDO - /events - includes event_id and created_at in event data", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  await doInstance.fetch(postJSON("/emit", { type: "test", data: null }));

  const res = await doInstance.fetch(getRequest("/events?after=0"));
  const body = await jsonBody(res);
  const events = body.events as Array<Record<string, unknown>>;
  assert(events[0].event_id !== undefined);
  assert(events[0].created_at !== undefined);
});

Deno.test("RunNotifierDO - /state - returns current DO state", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  const res = await doInstance.fetch(getRequest("/state"));
  const body = await jsonBody(res);
  assertEquals(body.runId, null);
  assertEquals(body.eventCount, 0);
  assertEquals(body.lastEventId, 0);
  assertEquals(body.connectionCount, 0);
});

Deno.test("RunNotifierDO - WebSocket handling - rejects WebSocket connections without auth validation", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const req = new Request("https://do.internal/ws", {
    headers: { Upgrade: "websocket" },
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 401);
});
Deno.test("RunNotifierDO - WebSocket handling - rejects when MAX_CONNECTIONS is reached", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

  // Fill to MAX_CONNECTIONS (10_000)
  const connections =
    (doInstance as unknown as { connections: Map<string, unknown> })
      .connections;
  for (let i = 0; i < 10_000; i++) {
    connections.set(`conn-${i}`, {} as never);
  }

  const req = new Request("https://do.internal/ws", {
    headers: { Upgrade: "websocket", "X-WS-Auth-Validated": "true" },
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 503);
});

Deno.test("RunNotifierDO - webSocketMessage - responds to ping with pong", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";

  await doInstance.webSocketMessage(ws as unknown as WebSocket, "ping");
  assert(ws.sent.some((message) => message.includes("pong")));
});
Deno.test("RunNotifierDO - webSocketMessage - updates lastActivity on message", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";
  ws.lastActivity = 0;

  const before = Date.now();
  await doInstance.webSocketMessage(ws as unknown as WebSocket, "ping");
  assert(ws.lastActivity >= before);
});
Deno.test("RunNotifierDO - webSocketMessage - handles subscribe message with matching runId", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  (doInstance as unknown as { runId: string }).runId = "run-abc";

  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";

  await doInstance.webSocketMessage(
    ws as unknown as WebSocket,
    JSON.stringify({ type: "subscribe", runId: "run-abc" }),
  );

  const response = JSON.parse(ws.sent[ws.sent.length - 1]);
  assertEquals(response.type, "subscribed");
  assertEquals(response.data.runId, "run-abc");
});
Deno.test("RunNotifierDO - webSocketMessage - sends error for mismatched runId", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  (doInstance as unknown as { runId: string }).runId = "run-abc";

  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";

  await doInstance.webSocketMessage(
    ws as unknown as WebSocket,
    JSON.stringify({ type: "subscribe", runId: "run-xyz" }),
  );

  const response = JSON.parse(ws.sent[ws.sent.length - 1]);
  assertEquals(response.type, "error");
  assertEquals(response.data.message, "runId mismatch");
});
Deno.test("RunNotifierDO - webSocketMessage - ignores binary messages", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";

  await doInstance.webSocketMessage(
    ws as unknown as WebSocket,
    new ArrayBuffer(10),
  );

  // No crash, no response besides activity update
  assertEquals(ws.sent.length, 0);
});
Deno.test("RunNotifierDO - webSocketMessage - ignores malformed JSON messages", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";

  await doInstance.webSocketMessage(
    ws as unknown as WebSocket,
    "{invalid json",
  );
  // Should not throw
  assertEquals(ws.sent.length, 0);
});

Deno.test("RunNotifierDO - webSocketClose - removes connection from map", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const connections =
    (doInstance as unknown as { connections: Map<string, unknown> })
      .connections;

  const ws = new MockWebSocket();
  ws.connectionId = "conn-close";
  connections.set("conn-close", ws as unknown as never);

  await doInstance.webSocketClose(ws as unknown as WebSocket);
  assertEquals(connections.has("conn-close"), false);
});

Deno.test("RunNotifierDO - webSocketError - removes connection on error", async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const connections =
    (doInstance as unknown as { connections: Map<string, unknown> })
      .connections;

  const ws = new MockWebSocket();
  ws.connectionId = "conn-err";
  connections.set("conn-err", ws as unknown as never);

  await doInstance.webSocketError(
    ws as unknown as WebSocket,
    new Error("oops"),
  );
  assertEquals(connections.has("conn-err"), false);
});

Deno.test("RunNotifierDO - alarm - broadcasts heartbeat and reschedules when connections exist", async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
  const { doInstance } = createDO({ state });

  const ws = new MockWebSocket();
  ws.connectionId = "conn-hb";
  ws.lastActivity = Date.now();
  (doInstance as unknown as { connections: Map<string, MockWebSocket> })
    .connections.set("conn-hb", ws as unknown as never);

  await doInstance.alarm();

  assert(ws.sent.length > 0);
  const hb = JSON.parse(ws.sent[0]);
  assertEquals(hb.type, "heartbeat");
  assert(state.storage.setAlarm.calls.length > 0);
});
Deno.test("RunNotifierDO - alarm - does not reschedule when no connections exist", async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
  const { doInstance } = createDO({ state });

  state.storage.setAlarm;
  await doInstance.alarm();

  assertSpyCalls(state.storage.setAlarm, 0);
});
Deno.test("RunNotifierDO - alarm - cleans up stale connections", async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
  const { doInstance } = createDO({ state });

  const ws = new MockWebSocket();
  ws.connectionId = "conn-stale";
  ws.lastActivity = Date.now() - 10 * 60 * 1000; // 10 minutes ago, beyond timeout
  (doInstance as unknown as { connections: Map<string, MockWebSocket> })
    .connections.set("conn-stale", ws as unknown as never);

  await doInstance.alarm();

  const connections =
    (doInstance as unknown as { connections: Map<string, unknown> })
      .connections;
  assertEquals(connections.has("conn-stale"), false);
});

Deno.test("RunNotifierDO - constructor hydration - restores state from storage", async () => {
  /* TODO: restore mocks manually */ void 0;
  const fakeTime = new FakeTime();
  try {
    const storage = createMockStorage();
    storage._store.set("bufferState", {
      eventBuffer: [{
        id: 10,
        type: "restored",
        data: null,
        timestamp: Date.now(),
      }],
      eventIdCounter: 10,
      runId: "run-restored",
    });

    const state = createMockState(storage);
    const doInstance = new RunNotifierDO(
      state as unknown as DurableObjectState,
      createMockEnv() as never,
    );

    // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
    await fakeTime.tickAsync(0);

    const res = await doInstance.fetch(getRequest("/state"));
    const body = await jsonBody(res);
    assertEquals(body.runId, "run-restored");
    assertEquals(body.lastEventId, 10);
    assertEquals(body.eventCount, 1);
  } finally {
    fakeTime.restore();
  }
});
Deno.test("RunNotifierDO - constructor hydration - rebuilds connections from hibernated WebSockets", async () => {
  /* TODO: restore mocks manually */ void 0;
  const fakeTime = new FakeTime();
  try {
    const storage = createMockStorage();
    const state = createMockState(storage);

    const ws = new MockWebSocket();
    state.getWebSockets = (() => [ws]) as any;
    state.getTags = (() => ["conn-hibernated"]) as any;

    const doInstance = new RunNotifierDO(
      state as unknown as DurableObjectState,
      createMockEnv() as never,
    );

    // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
    await fakeTime.tickAsync(0);

    const connections =
      (doInstance as unknown as { connections: Map<string, unknown> })
        .connections;
    assertEquals(connections.has("conn-hibernated"), true);
  } finally {
    fakeTime.restore();
  }
});
Deno.test("RunNotifierDO - constructor hydration - handles storage load failure gracefully", async () => {
  /* TODO: restore mocks manually */ void 0;
  const fakeTime = new FakeTime();
  try {
    const storage = createMockStorage();
    storage.get = (async () => {
      throw new Error("boom");
    }) as any;

    const state = createMockState(storage);
    const doInstance = new RunNotifierDO(
      state as unknown as DurableObjectState,
      createMockEnv() as never,
    );

    // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
    await fakeTime.tickAsync(0);

    // Should not crash, and state should be default
    const res = await doInstance.fetch(getRequest("/state"));
    const body = await jsonBody(res);
    assertEquals(body.eventCount, 0);
  } finally {
    fakeTime.restore();
  }
});

Deno.test("RunNotifierDO - segment buffer cap enforcement - enforces max segment buffer size", () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const enforcer = (doInstance as unknown as {
    enforceSegmentBufferCap: <T>(buffer: T[], label: string) => T[];
  }).enforceSegmentBufferCap.bind(doInstance);

  const bigBuffer = Array.from({ length: 10_001 }, (_, i) => ({ id: i }));
  const result = enforcer(bigBuffer, "test");
  assertEquals(result.length, 10_000);
  // Should keep the latest entries (drop oldest)
  assertEquals(result[0], { id: 1 });
});
Deno.test("RunNotifierDO - segment buffer cap enforcement - leaves buffer alone when within cap", () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const enforcer = (doInstance as unknown as {
    enforceSegmentBufferCap: <T>(buffer: T[], label: string) => T[];
  }).enforceSegmentBufferCap.bind(doInstance);

  const smallBuffer = [1, 2, 3];
  const result = enforcer(smallBuffer, "test");
  assertEquals(result, smallBuffer); // Same reference
});

Deno.test("RunNotifierDO - stringifyPersistedData - returns string values unchanged", () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const stringify = (doInstance as unknown as {
    stringifyPersistedData: (value: unknown) => string;
  }).stringifyPersistedData.bind(doInstance);

  assertEquals(stringify("already a string"), "already a string");
});
Deno.test("RunNotifierDO - stringifyPersistedData - JSON stringifies objects", () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const stringify = (doInstance as unknown as {
    stringifyPersistedData: (value: unknown) => string;
  }).stringifyPersistedData.bind(doInstance);

  assertEquals(stringify({ a: 1 }), '{"a":1}');
});
Deno.test("RunNotifierDO - stringifyPersistedData - handles circular references gracefully", () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
  const stringify = (doInstance as unknown as {
    stringifyPersistedData: (value: unknown) => string;
  }).stringifyPersistedData.bind(doInstance);

  const obj: Record<string, unknown> = {};
  obj.self = obj;
  // Should not throw
  const result = stringify(obj);
  assertEquals(typeof result, "string");
});
