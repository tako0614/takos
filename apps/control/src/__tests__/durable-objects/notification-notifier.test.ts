import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationNotifierDO } from '@/durable-objects/notification-notifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStorage() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => store.get(key) as T | undefined),
    put: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); return true; }),
    setAlarm: vi.fn(async (ms: number) => { alarm = ms; }),
    deleteAlarm: vi.fn(async () => { alarm = null; }),
    getAlarm: vi.fn(async () => alarm),
    list: vi.fn(async () => new Map()),
    _store: store,
  };
}

function createMockState(storage = createMockStorage()) {
  return {
    storage,
    blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
    getTags: vi.fn(() => []),
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

describe('NotificationNotifierDO', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetch routing', () => {
    it('returns 401 for non-internal, non-WebSocket requests', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(401);
    });

    it('returns 404 for unknown paths', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(getRequest('/unknown'));
      expect(res.status).toBe(404);
    });
  });

  describe('/emit', () => {
    it('emits an event and returns success', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/emit', { type: 'test_event', data: { msg: 'hello' } }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.success).toBe(true);
      expect(body.eventId).toBe(1);
      expect(body.clients).toBe(0);
    });

    it('assigns sequential event IDs', async () => {
      const { doInstance } = createDO();

      const r1 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'a', data: null })));
      const r2 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'b', data: null })));
      const r3 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'c', data: null })));

      expect(r1.eventId).toBe(1);
      expect(r2.eventId).toBe(2);
      expect(r3.eventId).toBe(3);
    });

    it('accepts preferred event_id', async () => {
      const { doInstance } = createDO();

      const r1 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'a', data: null, event_id: 10 })));
      expect(r1.eventId).toBe(10);

      const r2 = await jsonBody(await doInstance.fetch(postJSON('/emit', { type: 'b', data: null })));
      expect(r2.eventId).toBe(11);
    });

    it('persists state after emit', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/emit', { type: 'test', data: null }));

      expect(state.storage.put).toHaveBeenCalledWith('bufferState', expect.objectContaining({
        eventIdCounter: 1,
      }));
    });

    it('broadcasts to connected WebSocket clients', async () => {
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
      expect(body.clients).toBe(1);
      expect(ws.sent.length).toBeGreaterThan(0);

      const sent = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(sent.type).toBe('test');
      expect(sent.data).toEqual({ msg: 'hi' });
    });

    it('removes failed WebSocket connections on broadcast', async () => {
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
      expect(connections.has('conn-fail')).toBe(false);
    });
  });

  describe('/events', () => {
    it('returns events after a given ID', async () => {
      const { doInstance } = createDO();

      // Emit some events
      await doInstance.fetch(postJSON('/emit', { type: 'a', data: 1 }));
      await doInstance.fetch(postJSON('/emit', { type: 'b', data: 2 }));
      await doInstance.fetch(postJSON('/emit', { type: 'c', data: 3 }));

      const res = await doInstance.fetch(getRequest('/events?after=1'));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      const events = body.events as Array<{ type: string; event_id: string }>;
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('b');
      expect(events[1].type).toBe('c');
    });

    it('returns all events when after=0', async () => {
      const { doInstance } = createDO();
      await doInstance.fetch(postJSON('/emit', { type: 'a', data: null }));
      await doInstance.fetch(postJSON('/emit', { type: 'b', data: null }));

      const res = await doInstance.fetch(getRequest('/events?after=0'));
      const body = await jsonBody(res);
      expect((body.events as unknown[]).length).toBe(2);
      expect(body.lastEventId).toBe(2);
    });

    it('returns empty events when buffer is empty', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(getRequest('/events'));
      const body = await jsonBody(res);
      expect(body.events).toEqual([]);
      expect(body.lastEventId).toBe(0);
    });

    it('rejects invalid after cursors', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(getRequest('/events?after=abc'));

      expect(res.status).toBe(400);
      await expect(jsonBody(res)).resolves.toEqual({
        error: 'Invalid after cursor',
      });
    });
  });

  describe('/state', () => {
    it('returns current state', async () => {
      const { doInstance } = createDO();
      await doInstance.fetch(postJSON('/emit', { type: 'test', data: null }));

      const res = await doInstance.fetch(getRequest('/state'));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.eventCount).toBe(1);
      expect(body.lastEventId).toBe(1);
      expect(body.connectionCount).toBe(0);
    });
  });

  describe('WebSocket handling', () => {
    it('rejects WebSocket connections without auth validation', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/ws', {
        headers: { Upgrade: 'websocket' },
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(401);
    });

    it('rejects WebSocket connections without user ID', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/ws', {
        headers: { Upgrade: 'websocket', 'X-WS-Auth-Validated': 'true' },
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(401);
    });

    it('rejects WebSocket connections with mismatched user ID', async () => {
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
      expect(res.status).toBe(403);
    });

    it('rejects connections when hard cap is reached', async () => {
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
      expect(res.status).toBe(503);
    });

    it('rejects invalid last_event_id values before upgrading', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/ws?last_event_id=abc', {
        headers: {
          Upgrade: 'websocket',
          'X-WS-Auth-Validated': 'true',
          'X-WS-User-Id': 'user-1',
        },
      });
      const res = await doInstance.fetch(req);

      expect(res.status).toBe(400);
      await expect(jsonBody(res)).resolves.toEqual({
        error: 'Invalid last_event_id',
      });
    });
  });

  describe('webSocketMessage', () => {
    it('responds to ping with pong', async () => {
      const { doInstance } = createDO();
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';

      await doInstance.webSocketMessage(ws as unknown as WebSocket, 'ping');

      expect(ws.sent).toContain('pong');
    });

    it('updates lastActivity on any message', async () => {
      const { doInstance } = createDO();
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';
      ws.lastActivity = 0;

      const before = Date.now();
      await doInstance.webSocketMessage(ws as unknown as WebSocket, 'ping');
      expect(ws.lastActivity).toBeGreaterThanOrEqual(before);
    });
  });

  describe('webSocketClose', () => {
    it('removes connection from map on close', async () => {
      const { doInstance } = createDO();
      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-close';
      connections.set('conn-close', ws as unknown as never);

      await doInstance.webSocketClose(ws as unknown as WebSocket);

      expect(connections.has('conn-close')).toBe(false);
    });
  });

  describe('webSocketError', () => {
    it('removes connection on error', async () => {
      const { doInstance } = createDO();
      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-err';
      connections.set('conn-err', ws as unknown as never);

      await doInstance.webSocketError(ws as unknown as WebSocket, new Error('test error'));

      expect(connections.has('conn-err')).toBe(false);
    });
  });

  describe('alarm', () => {
    it('reschedules alarm when connections exist', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      // Add a connection with recent activity
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-alarm';
      ws.lastActivity = Date.now();
      (doInstance as unknown as { connections: Map<string, MockWebSocket> }).connections.set('conn-alarm', ws as unknown as never);

      await doInstance.alarm();

      expect(state.storage.setAlarm).toHaveBeenCalled();
    });

    it('does not reschedule alarm when no connections exist', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      // Reset mock counts from constructor
      state.storage.setAlarm.mockClear();

      await doInstance.alarm();

      expect(state.storage.setAlarm).not.toHaveBeenCalled();
    });
  });

  describe('constructor hydration', () => {
    it('restores state from storage on construction', async () => {
      const storage = createMockStorage();
      storage._store.set('bufferState', {
        eventBuffer: [{ id: 5, type: 'restored', data: null, timestamp: Date.now() }],
        eventIdCounter: 5,
        userId: 'user-restored',
      });

      const state = createMockState(storage);
      const doInstance = new NotificationNotifierDO(state as unknown as DurableObjectState);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await new Promise((r) => setTimeout(r, 0));

      // Verify state was restored by emitting and checking the counter
      const res = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(res);
      expect(body.userId).toBe('user-restored');
      expect(body.eventCount).toBe(1);
      expect(body.lastEventId).toBe(5);
    });

    it('starts with defaults when storage load fails', async () => {
      const storage = createMockStorage();
      storage.get.mockRejectedValueOnce(new Error('storage unavailable'));

      const state = createMockState(storage);
      const doInstance = new NotificationNotifierDO(state as unknown as DurableObjectState);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await new Promise((r) => setTimeout(r, 0));

      const res = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(res);
      expect(body.eventCount).toBe(0);
      expect(body.lastEventId).toBe(0);
      expect(body.userId).toBeNull();
    });
  });
});
