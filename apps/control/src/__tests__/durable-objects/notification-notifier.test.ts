import { NotificationNotifierDO } from '@/durable-objects/notification-notifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';
import { FakeTime } from 'jsr:@std/testing/time';

function createMockStorage() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    get: async <T>(key: string): Promise<T | undefined> => store.get(key) as T | undefined,
    put: async (key: string, value: unknown) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); return true; },
    setAlarm: async (ms: number) => { alarm = ms; },
    deleteAlarm: async () => { alarm = null; },
    getAlarm: async () => alarm,
    list: async () => new Map(),
    _store: store,
  };
}

function createMockState(storage = createMockStorage()) {
  return {
    storage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    acceptWebSocket: ((..._args: any[]) => undefined) as any,
    getWebSockets: () => [],
    getTags: () => [],
  };
}

/**
 * Mock WebSocket for tests. Simulates enough of the WebSocket API
 * for the DO implementation.
 */
class MockWebSocket {
  sent: string[] = [];
  closed = false;
  closeCode?: number;
  closeReason?: string;
  connectionId?: string;
  lastActivity?: number;

  send(data: string) {
    if (this.closed) throw new Error('WebSocket is closed');
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

/**
 * Mock WebSocketPair.
 * globalThis.WebSocketPair may not exist in Node, so we polyfill it.
 */
function installWebSocketPairMock() {
  const client = new MockWebSocket();
  const server = new MockWebSocket();

  (globalThis as Record<string, unknown>).WebSocketPair = class {
    0 = client;
    1 = server;
  };

  return { client, server };
}

function createDO(stateOverrides?: ReturnType<typeof createMockState>) {
  const state = stateOverrides ?? createMockState();
  const doInstance = new NotificationNotifierDO(state as unknown as DurableObjectState);
  return { doInstance, state };
}

function internalHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-Takos-Internal': '1', 'Content-Type': 'application/json', ...extra };
}

function postJSON(path: string, body: unknown, headers: Record<string, string> = internalHeaders()): Request {
  return new Request(`https://do.internal${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function getRequest(path: string, headers: Record<string, string> = internalHeaders()): Request {
  return new Request(`https://do.internal${path}`, {
    method: 'GET',
    headers,
  });
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


  
    Deno.test('NotificationNotifierDO - fetch routing - returns 401 for non-internal, non-WebSocket requests', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 401);
})
    Deno.test('NotificationNotifierDO - fetch routing - returns 404 for unknown paths', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(getRequest('/unknown'));
      assertEquals(res.status, 404);
})  
  
    Deno.test('NotificationNotifierDO - /emit - emits an event and returns success', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/emit', { type: 'test_event', data: { msg: 'hello' } }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.success, true);
      assertEquals(body.eventId, 1);
      assertEquals(body.clients, 0);
})
    Deno.test('NotificationNotifierDO - /emit - assigns sequential event IDs', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

      const r1 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'a', data: null })));
      const r2 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'b', data: null })));
      const r3 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'c', data: null })));

      assertEquals(r1.eventId, 1);
      assertEquals(r2.eventId, 2);
      assertEquals(r3.eventId, 3);
})
    Deno.test('NotificationNotifierDO - /emit - accepts preferred event_id', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

      const r1 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'a', data: null, event_id: 10 })));
      assertEquals(r1.eventId, 10);

      const r2 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'b', data: null })));
      assertEquals(r2.eventId, 11);
})
    Deno.test('NotificationNotifierDO - /emit - persists state after emit', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/emit', { type: 'test', data: null }));

      assertSpyCallArgs(state.storage.put, 0, ['bufferState', ({
        eventIdCounter: 1,
      })]);
})
    Deno.test('NotificationNotifierDO - /emit - broadcasts to connected WebSocket clients', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      // Simulate a connected WebSocket
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';
      ws.lastActivity = Date.now();
      // Inject into the connections map via internal state
      (doInstance as unknown as { connections: Map<string, MockWebSocket> }).connections.set('conn-1', ws as unknown as never);

      const res = await doInstance.fetch(postJSON('/emit', { type: 'test', data: { msg: 'hi' } }));
      const body = await jsonBody(res);
      assertEquals(body.clients, 1);
      assert(ws.sent.length > 0);

      const sent = JSON.parse(ws.sent[ws.sent.length - 1]);
      assertEquals(sent.type, 'test');
      assertEquals(sent.data, { msg: 'hi' });
})
    Deno.test('NotificationNotifierDO - /emit - removes failed WebSocket connections on broadcast', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-fail';
      ws.lastActivity = Date.now();
      // Make send throw
      ws.send = () => { throw new Error('closed'); };
      (doInstance as unknown as { connections: Map<string, MockWebSocket> }).connections.set('conn-fail', ws as unknown as never);

      await doInstance.fetch(postJSON('/emit', { type: 'test', data: null }));

      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;
      assertEquals(connections.has('conn-fail'), false);
})  
  
    Deno.test('NotificationNotifierDO - /events - returns events after a given ID', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

      // Emit some events
      await doInstance.fetch(postJSON('/emit', { type: 'a', data: 1 }));
      await doInstance.fetch(postJSON('/emit', { type: 'b', data: 2 }));
      await doInstance.fetch(postJSON('/emit', { type: 'c', data: 3 }));

      const res = await doInstance.fetch(getRequest('/events?after=1'));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      const events = body.events as Array<{ type: string; event_id: string }>;
      assertEquals(events.length, 2);
      assertEquals(events[0].type, 'b');
      assertEquals(events[1].type, 'c');
})
    Deno.test('NotificationNotifierDO - /events - returns all events when after=0', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      await doInstance.fetch(postJSON('/emit', { type: 'a', data: null }));
      await doInstance.fetch(postJSON('/emit', { type: 'b', data: null }));

      const res = await doInstance.fetch(getRequest('/events?after=0'));
      const body = await jsonBody(res);
      assertEquals((body.events as unknown[]).length, 2);
      assertEquals(body.lastEventId, 2);
})
    Deno.test('NotificationNotifierDO - /events - returns empty events when buffer is empty', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(getRequest('/events'));
      const body = await jsonBody(res);
      assertEquals(body.events, []);
      assertEquals(body.lastEventId, 0);
})
    Deno.test('NotificationNotifierDO - /events - rejects invalid after cursors', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(getRequest('/events?after=abc'));

      assertEquals(res.status, 400);
      await assertEquals(await jsonBody(res), {
        error: 'Invalid after cursor',
      });
})  
  
    Deno.test('NotificationNotifierDO - /state - returns current state', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      await doInstance.fetch(postJSON('/emit', { type: 'test', data: null }));

      const res = await doInstance.fetch(getRequest('/state'));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.eventCount, 1);
      assertEquals(body.lastEventId, 1);
      assertEquals(body.connectionCount, 0);
})  
  
    Deno.test('NotificationNotifierDO - WebSocket handling - rejects WebSocket connections without auth validation', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/ws', {
        headers: { Upgrade: 'websocket' },
      });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 401);
})
    Deno.test('NotificationNotifierDO - WebSocket handling - rejects WebSocket connections without user ID', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/ws', {
        headers: { Upgrade: 'websocket', 'X-WS-Auth-Validated': 'true' },
      });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 401);
})
    Deno.test('NotificationNotifierDO - WebSocket handling - rejects WebSocket connections with mismatched user ID', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      // Set userId via internal state
      (doInstance as unknown as { userId: string }).userId = 'user-1';

      const req = new Request('https://do.internal/ws', {
        headers: {
          Upgrade: 'websocket',
          'X-WS-Auth-Validated': 'true',
          'X-WS-User-Id': 'user-2',
        },
      });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 403);
})
    Deno.test('NotificationNotifierDO - WebSocket handling - rejects connections when hard cap is reached', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      // Fill the connections map to the hard cap
      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;
      for (let i = 0; i < 1000; i++) {
        connections.set(`conn-${i}`, {} as never);
      }

      const req = new Request('https://do.internal/ws', {
        headers: {
          Upgrade: 'websocket',
          'X-WS-Auth-Validated': 'true',
          'X-WS-User-Id': 'user-1',
        },
      });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 503);
})
    Deno.test('NotificationNotifierDO - WebSocket handling - rejects invalid last_event_id values before upgrading', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/ws?last_event_id=abc', {
        headers: {
          Upgrade: 'websocket',
          'X-WS-Auth-Validated': 'true',
          'X-WS-User-Id': 'user-1',
        },
      });
      const res = await doInstance.fetch(req);

      assertEquals(res.status, 400);
      await assertEquals(await jsonBody(res), {
        error: 'Invalid last_event_id',
      });
})  
  
    Deno.test('NotificationNotifierDO - webSocketMessage - responds to ping with pong', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';

      await doInstance.webSocketMessage(ws as unknown as WebSocket, 'ping');

      assertStringIncludes(ws.sent, 'pong');
})
    Deno.test('NotificationNotifierDO - webSocketMessage - updates lastActivity on any message', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';
      ws.lastActivity = 0;

      const before = Date.now();
      await doInstance.webSocketMessage(ws as unknown as WebSocket, 'ping');
      assert(ws.lastActivity >= before);
})  
  
    Deno.test('NotificationNotifierDO - webSocketClose - removes connection from map on close', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-close';
      connections.set('conn-close', ws as unknown as never);

      await doInstance.webSocketClose(ws as unknown as WebSocket);

      assertEquals(connections.has('conn-close'), false);
})  
  
    Deno.test('NotificationNotifierDO - webSocketError - removes connection on error', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-err';
      connections.set('conn-err', ws as unknown as never);

      await doInstance.webSocketError(ws as unknown as WebSocket, new Error('test error'));

      assertEquals(connections.has('conn-err'), false);
})  
  
    Deno.test('NotificationNotifierDO - alarm - reschedules alarm when connections exist', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      // Add a connection with recent activity
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-alarm';
      ws.lastActivity = Date.now();
      (doInstance as unknown as { connections: Map<string, MockWebSocket> }).connections.set('conn-alarm', ws as unknown as never);

      await doInstance.alarm();

      assert(state.storage.setAlarm.calls.length > 0);
})
    Deno.test('NotificationNotifierDO - alarm - does not reschedule alarm when no connections exist', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      // Reset mock counts from constructor
      state.storage.setAlarm;

      await doInstance.alarm();

      assertSpyCalls(state.storage.setAlarm, 0);
})  
  
    Deno.test('NotificationNotifierDO - constructor hydration - restores state from storage on construction', async () => {
  /* TODO: restore mocks manually */ void 0;
  new FakeTime();
  try {
  const storage = createMockStorage();
      storage._store.set('bufferState', {
        eventBuffer: [{ id: 5, type: 'restored', data: null, timestamp: Date.now() }],
        eventIdCounter: 5,
        userId: 'user-restored',
      });

      const state = createMockState(storage);
      const doInstance = new NotificationNotifierDO(state as unknown as DurableObjectState);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await await fakeTime.tickAsync(0);

      // Verify state was restored by emitting and checking the counter
      const res = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(res);
      assertEquals(body.userId, 'user-restored');
      assertEquals(body.eventCount, 1);
      assertEquals(body.lastEventId, 5);
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('NotificationNotifierDO - constructor hydration - starts with defaults when storage load fails', async () => {
  /* TODO: restore mocks manually */ void 0;
  new FakeTime();
  try {
  const storage = createMockStorage();
      storage.get = (async () => { throw new Error('storage unavailable'); }) as any;

      const state = createMockState(storage);
      const doInstance = new NotificationNotifierDO(state as unknown as DurableObjectState);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await await fakeTime.tickAsync(0);

      const res = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(res);
      assertEquals(body.eventCount, 0);
      assertEquals(body.lastEventId, 0);
      assertEquals(body.userId, null);
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})  