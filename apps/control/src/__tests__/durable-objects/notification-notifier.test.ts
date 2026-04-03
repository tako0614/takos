import { NotificationNotifierDO } from "@/durable-objects/notification-notifier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCalls } from "jsr:@std/testing/mock";
import {
  createMockState,
  createMockStorage,
  getRequest,
  jsonBody,
  type MockState,
  MockWebSocket,
  postJSON,
  withFakeTime,
} from "./test-helpers.ts";

function createDO(stateOverrides?: MockState) {
  const state = stateOverrides ?? createMockState();
  const doInstance = new NotificationNotifierDO(
    state as unknown as DurableObjectState,
  );
  return { doInstance, state };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("NotificationNotifierDO - fetch routing - returns 401 for non-internal, non-WebSocket requests", async () => {
  const { doInstance } = createDO();
  const req = new Request("https://do.internal/emit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 401);
});
Deno.test("NotificationNotifierDO - fetch routing - returns 404 for unknown paths", async () => {
  const { doInstance } = createDO();
  const res = await doInstance.fetch(getRequest("/unknown"));
  assertEquals(res.status, 404);
});

Deno.test("NotificationNotifierDO - /emit - emits an event and returns success", async () => {
  const { doInstance } = createDO();
  const res = await doInstance.fetch(
    postJSON("/emit", { type: "test_event", data: { msg: "hello" } }),
  );
  assertEquals(res.status, 200);

  const body = await jsonBody(res);
  assertEquals(body.success, true);
  assertEquals(body.eventId, 1);
  assertEquals(body.clients, 0);
});
Deno.test("NotificationNotifierDO - /emit - assigns sequential event IDs", async () => {
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
Deno.test("NotificationNotifierDO - /emit - accepts preferred event_id", async () => {
  const { doInstance } = createDO();

  const r1 = await jsonBody(
    await doInstance.fetch(
      postJSON("/emit", { type: "a", data: null, event_id: 10 }),
    ),
  );
  assertEquals(r1.eventId, 10);

  const r2 = await jsonBody(
    await doInstance.fetch(postJSON("/emit", { type: "b", data: null })),
  );
  assertEquals(r2.eventId, 11);
});
Deno.test("NotificationNotifierDO - /emit - persists state after emit", async () => {
  const state = createMockState();
  const { doInstance } = createDO(state);

  await doInstance.fetch(postJSON("/emit", { type: "test", data: null }));

  const persisted = state.storage.put.calls[0].args[1] as Record<
    string,
    unknown
  >;
  assertEquals(persisted.eventIdCounter, 1);
  assertEquals(persisted.userId, null);
  assertEquals(Array.isArray(persisted.eventBuffer), true);
});
Deno.test("NotificationNotifierDO - /emit - broadcasts to connected WebSocket clients", async () => {
  const state = createMockState();
  const { doInstance } = createDO(state);

  // Simulate a connected WebSocket
  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";
  ws.lastActivity = Date.now();
  // Inject into the connections map via internal state
  (doInstance as unknown as { connections: Map<string, MockWebSocket> })
    .connections.set("conn-1", ws as unknown as never);

  const res = await doInstance.fetch(
    postJSON("/emit", { type: "test", data: { msg: "hi" } }),
  );
  const body = await jsonBody(res);
  assertEquals(body.clients, 1);
  assert(ws.sent.length > 0);

  const sent = JSON.parse(ws.sent[ws.sent.length - 1]);
  assertEquals(sent.type, "test");
  assertEquals(sent.data, { msg: "hi" });
});
Deno.test("NotificationNotifierDO - /emit - removes failed WebSocket connections on broadcast", async () => {
  const state = createMockState();
  const { doInstance } = createDO(state);

  const ws = new MockWebSocket();
  ws.connectionId = "conn-fail";
  ws.lastActivity = Date.now();
  // Make send throw
  ws.send = () => {
    throw new Error("closed");
  };
  (doInstance as unknown as { connections: Map<string, MockWebSocket> })
    .connections.set("conn-fail", ws as unknown as never);

  await doInstance.fetch(postJSON("/emit", { type: "test", data: null }));

  const connections =
    (doInstance as unknown as { connections: Map<string, unknown> })
      .connections;
  assertEquals(connections.has("conn-fail"), false);
});

Deno.test("NotificationNotifierDO - /events - returns events after a given ID", async () => {
  const { doInstance } = createDO();

  // Emit some events
  await doInstance.fetch(postJSON("/emit", { type: "a", data: 1 }));
  await doInstance.fetch(postJSON("/emit", { type: "b", data: 2 }));
  await doInstance.fetch(postJSON("/emit", { type: "c", data: 3 }));

  const res = await doInstance.fetch(getRequest("/events?after=1"));
  assertEquals(res.status, 200);

  const body = await jsonBody(res);
  const events = body.events as Array<{ type: string; event_id: string }>;
  assertEquals(events.length, 2);
  assertEquals(events[0].type, "b");
  assertEquals(events[1].type, "c");
});
Deno.test("NotificationNotifierDO - /events - returns all events when after=0", async () => {
  const { doInstance } = createDO();
  await doInstance.fetch(postJSON("/emit", { type: "a", data: null }));
  await doInstance.fetch(postJSON("/emit", { type: "b", data: null }));

  const res = await doInstance.fetch(getRequest("/events?after=0"));
  const body = await jsonBody(res);
  assertEquals((body.events as unknown[]).length, 2);
  assertEquals(body.lastEventId, 2);
});
Deno.test("NotificationNotifierDO - /events - returns empty events when buffer is empty", async () => {
  const { doInstance } = createDO();
  const res = await doInstance.fetch(getRequest("/events"));
  const body = await jsonBody(res);
  assertEquals(body.events, []);
  assertEquals(body.lastEventId, 0);
});
Deno.test("NotificationNotifierDO - /events - rejects invalid after cursors", async () => {
  const { doInstance } = createDO();
  const res = await doInstance.fetch(getRequest("/events?after=abc"));

  assertEquals(res.status, 400);
  await assertEquals(await jsonBody(res), {
    error: "Invalid after cursor",
  });
});

Deno.test("NotificationNotifierDO - /state - returns current state", async () => {
  const { doInstance } = createDO();
  await doInstance.fetch(postJSON("/emit", { type: "test", data: null }));

  const res = await doInstance.fetch(getRequest("/state"));
  assertEquals(res.status, 200);

  const body = await jsonBody(res);
  assertEquals(body.eventCount, 1);
  assertEquals(body.lastEventId, 1);
  assertEquals(body.connectionCount, 0);
});

Deno.test("NotificationNotifierDO - WebSocket handling - rejects WebSocket connections without auth validation", async () => {
  const { doInstance } = createDO();
  const req = new Request("https://do.internal/ws", {
    headers: { Upgrade: "websocket" },
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 401);
});
Deno.test("NotificationNotifierDO - WebSocket handling - rejects WebSocket connections without user ID", async () => {
  const { doInstance } = createDO();
  const req = new Request("https://do.internal/ws", {
    headers: { Upgrade: "websocket", "X-WS-Auth-Validated": "true" },
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 401);
});
Deno.test("NotificationNotifierDO - WebSocket handling - rejects WebSocket connections with mismatched user ID", async () => {
  const state = createMockState();
  const { doInstance } = createDO(state);

  // Set userId via internal state
  (doInstance as unknown as { userId: string }).userId = "user-1";

  const req = new Request("https://do.internal/ws", {
    headers: {
      Upgrade: "websocket",
      "X-WS-Auth-Validated": "true",
      "X-WS-User-Id": "user-2",
    },
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 403);
});
Deno.test("NotificationNotifierDO - WebSocket handling - rejects connections when hard cap is reached", async () => {
  const state = createMockState();
  const { doInstance } = createDO(state);

  // Fill the connections map to the hard cap
  const connections =
    (doInstance as unknown as { connections: Map<string, unknown> })
      .connections;
  for (let i = 0; i < 1000; i++) {
    connections.set(`conn-${i}`, {} as never);
  }

  const req = new Request("https://do.internal/ws", {
    headers: {
      Upgrade: "websocket",
      "X-WS-Auth-Validated": "true",
      "X-WS-User-Id": "user-1",
    },
  });
  const res = await doInstance.fetch(req);
  assertEquals(res.status, 503);
});
Deno.test("NotificationNotifierDO - WebSocket handling - rejects invalid last_event_id values before upgrading", async () => {
  const { doInstance } = createDO();
  const req = new Request("https://do.internal/ws?last_event_id=abc", {
    headers: {
      Upgrade: "websocket",
      "X-WS-Auth-Validated": "true",
      "X-WS-User-Id": "user-1",
    },
  });
  const res = await doInstance.fetch(req);

  assertEquals(res.status, 400);
  await assertEquals(await jsonBody(res), {
    error: "Invalid last_event_id",
  });
});

Deno.test("NotificationNotifierDO - webSocketMessage - responds to ping with pong", async () => {
  const { doInstance } = createDO();
  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";

  await doInstance.webSocketMessage(ws as unknown as WebSocket, "ping");

  assert(ws.sent.some((message) => message.includes("pong")));
});
Deno.test("NotificationNotifierDO - webSocketMessage - updates lastActivity on any message", async () => {
  const { doInstance } = createDO();
  const ws = new MockWebSocket();
  ws.connectionId = "conn-1";
  ws.lastActivity = 0;

  const before = Date.now();
  await doInstance.webSocketMessage(ws as unknown as WebSocket, "ping");
  assert(ws.lastActivity >= before);
});

Deno.test("NotificationNotifierDO - webSocketClose - removes connection from map on close", async () => {
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

Deno.test("NotificationNotifierDO - webSocketError - removes connection on error", async () => {
  const { doInstance } = createDO();
  const connections =
    (doInstance as unknown as { connections: Map<string, unknown> })
      .connections;

  const ws = new MockWebSocket();
  ws.connectionId = "conn-err";
  connections.set("conn-err", ws as unknown as never);

  await doInstance.webSocketError(
    ws as unknown as WebSocket,
    new Error("test error"),
  );

  assertEquals(connections.has("conn-err"), false);
});

Deno.test("NotificationNotifierDO - alarm - reschedules alarm when connections exist", async () => {
  const state = createMockState();
  const { doInstance } = createDO(state);

  // Add a connection with recent activity
  const ws = new MockWebSocket();
  ws.connectionId = "conn-alarm";
  ws.lastActivity = Date.now();
  (doInstance as unknown as { connections: Map<string, MockWebSocket> })
    .connections.set("conn-alarm", ws as unknown as never);

  await doInstance.alarm();

  assert(state.storage.setAlarm.calls.length > 0);
});
Deno.test("NotificationNotifierDO - alarm - does not reschedule alarm when no connections exist", async () => {
  const state = createMockState();
  const { doInstance } = createDO(state);

  // Reset mock counts from constructor
  state.storage.setAlarm;

  await doInstance.alarm();

  assertSpyCalls(state.storage.setAlarm, 0);
});

Deno.test("NotificationNotifierDO - constructor hydration - restores state from storage on construction", async () => {
  await withFakeTime(async (fakeTime) => {
    const storage = createMockStorage();
    storage._store.set("bufferState", {
      eventBuffer: [{
        id: 5,
        type: "restored",
        data: null,
        timestamp: Date.now(),
      }],
      eventIdCounter: 5,
      userId: "user-restored",
    });

    const state = createMockState(storage);
    const doInstance = new NotificationNotifierDO(
      state as unknown as DurableObjectState,
    );

    // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
    await fakeTime.tickAsync(0);

    // Verify state was restored by emitting and checking the counter
    const res = await doInstance.fetch(getRequest("/state"));
    const body = await jsonBody(res);
    assertEquals(body.userId, "user-restored");
    assertEquals(body.eventCount, 1);
    assertEquals(body.lastEventId, 5);
  });
});
Deno.test("NotificationNotifierDO - constructor hydration - starts with defaults when storage load fails", async () => {
  await withFakeTime(async (fakeTime) => {
    const storage = createMockStorage();
    storage.get = (async () => {
      throw new Error("storage unavailable");
    }) as any;

    const state = createMockState(storage);
    const doInstance = new NotificationNotifierDO(
      state as unknown as DurableObjectState,
    );

    // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
    await fakeTime.tickAsync(0);

    const res = await doInstance.fetch(getRequest("/state"));
    const body = await jsonBody(res);
    assertEquals(body.eventCount, 0);
    assertEquals(body.lastEventId, 0);
    assertEquals(body.userId, null);
  });
});
