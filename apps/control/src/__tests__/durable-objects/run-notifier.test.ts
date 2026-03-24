import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunNotifierDO } from '@/durable-objects/run-notifier';

// ---------------------------------------------------------------------------
// Mock the heavy dependencies used in RunNotifierDO
// ---------------------------------------------------------------------------

vi.mock('@/db', () => ({
  getDb: vi.fn(() => ({
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => ({})),
      })),
    })),
  })),
  runs: { id: 'id', lastEventId: 'lastEventId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));

vi.mock('@/services/offload/run-events', () => ({
  RUN_EVENT_SEGMENT_SIZE: 100,
  segmentIndexForEventId: (eventId: number) => Math.floor((eventId - 1) / 100) + 1,
  writeRunEventSegmentToR2: vi.fn(async () => {}),
}));

vi.mock('@/services/offload/usage-events', () => ({
  USAGE_EVENT_SEGMENT_SIZE: 200,
  writeUsageEventSegmentToR2: vi.fn(async () => {}),
}));

vi.mock('@/services/run-notifier', () => ({
  RUN_TERMINAL_EVENT_TYPES: new Set(['completed', 'error', 'cancelled', 'run.failed']),
}));

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

function createMockState(storage = createMockStorage()): any {
  return {
    storage,
    blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
    getTags: vi.fn(() => []),
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
    if (this.closed) throw new Error('WebSocket closed');
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

function createDO(opts: { env?: Record<string, unknown>; state?: ReturnType<typeof createMockState> } = {}) {
  const state = opts.state ?? createMockState();
  const env = opts.env ?? createMockEnv();
  const doInstance = new RunNotifierDO(state as unknown as DurableObjectState, env as never);
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

describe('RunNotifierDO', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetch routing', () => {
    it('returns 401 for non-internal, non-auth requests', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(401);
    });

    it('allows requests with X-WS-Auth-Validated header', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/state', {
        method: 'GET',
        headers: { 'X-WS-Auth-Validated': 'true' },
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(200);
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
      const res = await doInstance.fetch(postJSON('/emit', {
        type: 'message',
        data: { text: 'hello' },
      }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.success).toBe(true);
      expect(body.eventId).toBe(1);
      expect(body.clients).toBe(0);
    });

    it('sets runId from first emit', async () => {
      const { doInstance } = createDO();
      await doInstance.fetch(postJSON('/emit', {
        type: 'start',
        data: null,
        runId: 'run-123',
      }));

      const stateRes = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(stateRes);
      expect(body.runId).toBe('run-123');
    });

    it('does not overwrite existing runId', async () => {
      const { doInstance } = createDO();
      await doInstance.fetch(postJSON('/emit', {
        type: 'start',
        data: null,
        runId: 'run-first',
      }));
      await doInstance.fetch(postJSON('/emit', {
        type: 'update',
        data: null,
        runId: 'run-second',
      }));

      const stateRes = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(stateRes);
      expect(body.runId).toBe('run-first');
    });

    it('validates runId format', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/emit', {
        type: 'test',
        data: null,
        runId: 'invalid run id!',
      }));
      expect(res.status).toBe(400);
      const body = await jsonBody(res);
      expect(body.error).toBe('Invalid runId');
    });

    it('validates runId length', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/emit', {
        type: 'test',
        data: null,
        runId: 'a'.repeat(65),
      }));
      expect(res.status).toBe(400);
    });

    it('rejects empty type', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/emit', {
        type: '',
        data: null,
      }));
      expect(res.status).toBe(400);
      const body = await jsonBody(res);
      expect(body.error).toBe('Invalid type');
    });

    it('rejects type longer than 256 chars', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/emit', {
        type: 'x'.repeat(257),
        data: null,
      }));
      expect(res.status).toBe(400);
    });

    it('rejects data larger than 1MB', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/emit', {
        type: 'big',
        data: 'x'.repeat(1_048_576),
      }));
      expect(res.status).toBe(400);
      const body = await jsonBody(res);
      expect(body.error).toBe('Data too large');
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
      const r1 = await jsonBody(await doInstance.fetch(postJSON('/emit', {
        type: 'a',
        data: null,
        event_id: 50,
      })));
      expect(r1.eventId).toBe(50);
    });

    it('broadcasts to connected WebSocket clients', async () => {
      const { doInstance } = createDO();

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';
      ws.lastActivity = Date.now();
      (doInstance as unknown as { connections: Map<string, MockWebSocket> }).connections.set('conn-1', ws as unknown as never);

      const res = await doInstance.fetch(postJSON('/emit', { type: 'test', data: { v: 1 } }));
      const body = await jsonBody(res);
      expect(body.clients).toBe(1);
      expect(ws.sent.length).toBeGreaterThan(0);

      const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(msg.type).toBe('test');
      expect(msg.event_id).toBeDefined();
      expect(msg.created_at).toBeDefined();
    });

    it('removes failed connections during broadcast', async () => {
      const { doInstance } = createDO();

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-fail';
      ws.lastActivity = Date.now();
      ws.send = () => { throw new Error('dead'); };
      (doInstance as unknown as { connections: Map<string, MockWebSocket> }).connections.set('conn-fail', ws as unknown as never);

      await doInstance.fetch(postJSON('/emit', { type: 'test', data: null }));

      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;
      expect(connections.has('conn-fail')).toBe(false);
    });

    it('persists state after emit', async () => {
      const state = createMockState();
      const { doInstance } = createDO({ state });

      await doInstance.fetch(postJSON('/emit', { type: 'test', data: null }));

      expect(state.storage.put).toHaveBeenCalledWith('bufferState', expect.objectContaining({
        eventIdCounter: 1,
      }));
    });

    it('returns 400 for invalid JSON body', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/emit', {
        method: 'POST',
        headers: internalHeaders(),
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(400);
    });
  });

  describe('/usage', () => {
    it('records usage events', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/usage', {
        runId: 'run-1',
        meter_type: 'input_tokens',
        units: 100,
      }));
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body.success).toBe(true);
    });

    it('rejects missing meter_type', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/usage', {
        units: 100,
      }));
      const body = await jsonBody(res);
      expect(body.success).toBe(false);
      expect(body.error).toBe('meter_type is required');
    });

    it('rejects non-positive units', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/usage', {
        meter_type: 'tokens',
        units: 0,
      }));
      const body = await jsonBody(res);
      expect(body.success).toBe(false);
      expect(body.error).toBe('units must be positive');
    });

    it('rejects negative units', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/usage', {
        meter_type: 'tokens',
        units: -5,
      }));
      const body = await jsonBody(res);
      expect(body.success).toBe(false);
    });

    it('rejects NaN units', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/usage', {
        meter_type: 'tokens',
        units: 'not-a-number',
      }));
      const body = await jsonBody(res);
      expect(body.success).toBe(false);
    });

    it('sets runId from usage if not already set', async () => {
      const { doInstance } = createDO();
      await doInstance.fetch(postJSON('/usage', {
        runId: 'run-from-usage',
        meter_type: 'tokens',
        units: 50,
      }));

      const stateRes = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(stateRes);
      expect(body.runId).toBe('run-from-usage');
    });

    it('includes reference_type and metadata', async () => {
      const state = createMockState();
      const { doInstance } = createDO({ state });

      await doInstance.fetch(postJSON('/usage', {
        meter_type: 'tokens',
        units: 100,
        reference_type: 'prompt',
        metadata: { model: 'gpt-4' },
      }));

      // Verify usage was buffered (check via state persist)
      expect(state.storage.put).toHaveBeenCalledWith('bufferState', expect.objectContaining({
        usageSegmentBuffer: expect.arrayContaining([
          expect.objectContaining({
            meter_type: 'tokens',
            units: 100,
            reference_type: 'prompt',
          }),
        ]),
      }));
    });

    it('returns 400 for invalid JSON body', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/usage', {
        method: 'POST',
        headers: internalHeaders(),
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(400);
    });
  });

  describe('/events', () => {
    it('returns events after a given ID', async () => {
      const { doInstance } = createDO();

      await doInstance.fetch(postJSON('/emit', { type: 'a', data: 1 }));
      await doInstance.fetch(postJSON('/emit', { type: 'b', data: 2 }));
      await doInstance.fetch(postJSON('/emit', { type: 'c', data: 3 }));

      const res = await doInstance.fetch(getRequest('/events?after=1'));
      const body = await jsonBody(res);
      const events = body.events as Array<{ type: string }>;
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('b');
      expect(events[1].type).toBe('c');
    });

    it('includes event_id and created_at in event data', async () => {
      const { doInstance } = createDO();
      await doInstance.fetch(postJSON('/emit', { type: 'test', data: null }));

      const res = await doInstance.fetch(getRequest('/events?after=0'));
      const body = await jsonBody(res);
      const events = body.events as Array<Record<string, unknown>>;
      expect(events[0].event_id).toBeDefined();
      expect(events[0].created_at).toBeDefined();
    });
  });

  describe('/state', () => {
    it('returns current DO state', async () => {
      const { doInstance } = createDO();

      const res = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(res);
      expect(body.runId).toBeNull();
      expect(body.eventCount).toBe(0);
      expect(body.lastEventId).toBe(0);
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

    it('rejects when MAX_CONNECTIONS is reached', async () => {
      const { doInstance } = createDO();

      // Fill to MAX_CONNECTIONS (10_000)
      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;
      for (let i = 0; i < 10_000; i++) {
        connections.set(`conn-${i}`, {} as never);
      }

      const req = new Request('https://do.internal/ws', {
        headers: { Upgrade: 'websocket', 'X-WS-Auth-Validated': 'true' },
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(503);
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

    it('updates lastActivity on message', async () => {
      const { doInstance } = createDO();
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';
      ws.lastActivity = 0;

      const before = Date.now();
      await doInstance.webSocketMessage(ws as unknown as WebSocket, 'ping');
      expect(ws.lastActivity).toBeGreaterThanOrEqual(before);
    });

    it('handles subscribe message with matching runId', async () => {
      const { doInstance } = createDO();
      (doInstance as unknown as { runId: string }).runId = 'run-abc';

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';

      await doInstance.webSocketMessage(
        ws as unknown as WebSocket,
        JSON.stringify({ type: 'subscribe', runId: 'run-abc' }),
      );

      const response = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(response.type).toBe('subscribed');
      expect(response.data.runId).toBe('run-abc');
    });

    it('sends error for mismatched runId', async () => {
      const { doInstance } = createDO();
      (doInstance as unknown as { runId: string }).runId = 'run-abc';

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';

      await doInstance.webSocketMessage(
        ws as unknown as WebSocket,
        JSON.stringify({ type: 'subscribe', runId: 'run-xyz' }),
      );

      const response = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(response.type).toBe('error');
      expect(response.data.message).toBe('runId mismatch');
    });

    it('ignores binary messages', async () => {
      const { doInstance } = createDO();
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';

      await doInstance.webSocketMessage(ws as unknown as WebSocket, new ArrayBuffer(10));

      // No crash, no response besides activity update
      expect(ws.sent).toHaveLength(0);
    });

    it('ignores malformed JSON messages', async () => {
      const { doInstance } = createDO();
      const ws = new MockWebSocket();
      ws.connectionId = 'conn-1';

      await doInstance.webSocketMessage(ws as unknown as WebSocket, '{invalid json');
      // Should not throw
      expect(ws.sent).toHaveLength(0);
    });
  });

  describe('webSocketClose', () => {
    it('removes connection from map', async () => {
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

      await doInstance.webSocketError(ws as unknown as WebSocket, new Error('oops'));
      expect(connections.has('conn-err')).toBe(false);
    });
  });

  describe('alarm', () => {
    it('broadcasts heartbeat and reschedules when connections exist', async () => {
      const state = createMockState();
      const { doInstance } = createDO({ state });

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-hb';
      ws.lastActivity = Date.now();
      (doInstance as unknown as { connections: Map<string, MockWebSocket> }).connections.set('conn-hb', ws as unknown as never);

      await doInstance.alarm();

      expect(ws.sent.length).toBeGreaterThan(0);
      const hb = JSON.parse(ws.sent[0]);
      expect(hb.type).toBe('heartbeat');
      expect(state.storage.setAlarm).toHaveBeenCalled();
    });

    it('does not reschedule when no connections exist', async () => {
      const state = createMockState();
      const { doInstance } = createDO({ state });

      state.storage.setAlarm.mockClear();
      await doInstance.alarm();

      expect(state.storage.setAlarm).not.toHaveBeenCalled();
    });

    it('cleans up stale connections', async () => {
      const state = createMockState();
      const { doInstance } = createDO({ state });

      const ws = new MockWebSocket();
      ws.connectionId = 'conn-stale';
      ws.lastActivity = Date.now() - 10 * 60 * 1000; // 10 minutes ago, beyond timeout
      (doInstance as unknown as { connections: Map<string, MockWebSocket> }).connections.set('conn-stale', ws as unknown as never);

      await doInstance.alarm();

      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;
      expect(connections.has('conn-stale')).toBe(false);
    });
  });

  describe('constructor hydration', () => {
    it('restores state from storage', async () => {
      const storage = createMockStorage();
      storage._store.set('bufferState', {
        eventBuffer: [{ id: 10, type: 'restored', data: null, timestamp: Date.now() }],
        eventIdCounter: 10,
        runId: 'run-restored',
      });

      const state = createMockState(storage);
      const doInstance = new RunNotifierDO(state as unknown as DurableObjectState, createMockEnv() as never);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await new Promise((r) => setTimeout(r, 0));

      const res = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(res);
      expect(body.runId).toBe('run-restored');
      expect(body.lastEventId).toBe(10);
      expect(body.eventCount).toBe(1);
    });

    it('rebuilds connections from hibernated WebSockets', async () => {
      const storage = createMockStorage();
      const state = createMockState(storage);

      const ws = new MockWebSocket();
      state.getWebSockets.mockReturnValueOnce([ws]);
      state.getTags.mockReturnValueOnce(['conn-hibernated']);

      const doInstance = new RunNotifierDO(state as unknown as DurableObjectState, createMockEnv() as never);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await new Promise((r) => setTimeout(r, 0));

      const connections = (doInstance as unknown as { connections: Map<string, unknown> }).connections;
      expect(connections.has('conn-hibernated')).toBe(true);
    });

    it('handles storage load failure gracefully', async () => {
      const storage = createMockStorage();
      storage.get.mockRejectedValueOnce(new Error('boom'));

      const state = createMockState(storage);
      const doInstance = new RunNotifierDO(state as unknown as DurableObjectState, createMockEnv() as never);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await new Promise((r) => setTimeout(r, 0));

      // Should not crash, and state should be default
      const res = await doInstance.fetch(getRequest('/state'));
      const body = await jsonBody(res);
      expect(body.eventCount).toBe(0);
    });
  });

  describe('segment buffer cap enforcement', () => {
    it('enforces max segment buffer size', () => {
      const { doInstance } = createDO();
      const enforcer = (doInstance as unknown as {
        enforceSegmentBufferCap: <T>(buffer: T[], label: string) => T[];
      }).enforceSegmentBufferCap.bind(doInstance);

      const bigBuffer = Array.from({ length: 10_001 }, (_, i) => ({ id: i }));
      const result = enforcer(bigBuffer, 'test');
      expect(result.length).toBe(10_000);
      // Should keep the latest entries (drop oldest)
      expect(result[0]).toEqual({ id: 1 });
    });

    it('leaves buffer alone when within cap', () => {
      const { doInstance } = createDO();
      const enforcer = (doInstance as unknown as {
        enforceSegmentBufferCap: <T>(buffer: T[], label: string) => T[];
      }).enforceSegmentBufferCap.bind(doInstance);

      const smallBuffer = [1, 2, 3];
      const result = enforcer(smallBuffer, 'test');
      expect(result).toBe(smallBuffer); // Same reference
    });
  });

  describe('stringifyPersistedData', () => {
    it('returns string values unchanged', () => {
      const { doInstance } = createDO();
      const stringify = (doInstance as unknown as {
        stringifyPersistedData: (value: unknown) => string;
      }).stringifyPersistedData.bind(doInstance);

      expect(stringify('already a string')).toBe('already a string');
    });

    it('JSON stringifies objects', () => {
      const { doInstance } = createDO();
      const stringify = (doInstance as unknown as {
        stringifyPersistedData: (value: unknown) => string;
      }).stringifyPersistedData.bind(doInstance);

      expect(stringify({ a: 1 })).toBe('{"a":1}');
    });

    it('handles circular references gracefully', () => {
      const { doInstance } = createDO();
      const stringify = (doInstance as unknown as {
        stringifyPersistedData: (value: unknown) => string;
      }).stringifyPersistedData.bind(doInstance);

      const obj: Record<string, unknown> = {};
      obj.self = obj;
      // Should not throw
      const result = stringify(obj);
      expect(typeof result).toBe('string');
    });
  });
});
