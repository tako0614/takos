import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiterDO } from '@/durable-objects/rate-limiter';

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
  };
}

function createDO(stateOverrides?: ReturnType<typeof createMockState>) {
  const state = stateOverrides ?? createMockState();
  const doInstance = new RateLimiterDO(state as unknown as DurableObjectState);
  return { doInstance, state };
}

function postJSON(path: string, body: unknown): Request {
  return new Request(`https://do.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RateLimiterDO', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetch routing', () => {
    it('returns 404 for unknown paths', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/unknown', { method: 'POST' });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(404);
    });

    it('returns 404 for GET on /check', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/check', { method: 'GET' });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(404);
    });

    it('returns 500 for malformed JSON', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/check', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(500);
    });
  });

  describe('/check (sliding_window)', () => {
    it('returns allowed=true within rate limit', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/check', {
        key: 'user:1',
        maxRequests: 10,
        windowMs: 60000,
      }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.allowed).toBe(true);
      expect(body.remaining).toBe(10);
      expect(body.total).toBe(10);
      expect(body.algorithm).toBe('sliding_window');
    });

    it('returns correct remaining count after hits', async () => {
      const { doInstance } = createDO();

      // Hit 3 times
      for (let i = 0; i < 3; i++) {
        await doInstance.fetch(postJSON('/hit', {
          key: 'user:2',
          maxRequests: 5,
          windowMs: 60000,
        }));
      }

      const res = await doInstance.fetch(postJSON('/check', {
        key: 'user:2',
        maxRequests: 5,
        windowMs: 60000,
      }));
      const body = await jsonBody(res);
      expect(body.remaining).toBe(2);
    });
  });

  describe('/check (token_bucket)', () => {
    it('returns allowed=true with full bucket', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/check', {
        key: 'user:tb',
        maxRequests: 10,
        windowMs: 60000,
        algorithm: 'token_bucket',
      }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.allowed).toBe(true);
      expect(body.remaining).toBe(10);
      expect(body.algorithm).toBe('token_bucket');
    });
  });

  describe('/check (shadow)', () => {
    it('returns both sliding_window and shadow token_bucket results', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/check', {
        key: 'user:shadow',
        maxRequests: 10,
        windowMs: 60000,
        algorithm: 'shadow',
      }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.algorithm).toBe('sliding_window');
      expect(body.shadow).toBeDefined();
      const shadow = body.shadow as Record<string, Record<string, unknown>>;
      expect(shadow.token_bucket).toBeDefined();
      expect(shadow.token_bucket.allowed).toBe(true);
    });
  });

  describe('/hit (sliding_window)', () => {
    it('allows requests within limit', async () => {
      const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'hit:1',
        maxRequests: 5,
        windowMs: 60000,
      })));

      expect(body.allowed).toBe(true);
      expect(body.remaining).toBe(4);
      expect(body.algorithm).toBe('sliding_window');
    });

    it('denies requests when limit is exhausted', async () => {
      const { doInstance } = createDO();

      let lastBody;
      for (let i = 0; i < 6; i++) {
        lastBody = await jsonBody(await doInstance.fetch(postJSON('/hit', {
          key: 'hit:limit',
          maxRequests: 5,
          windowMs: 60000,
        })));
      }

      expect(lastBody!.allowed).toBe(false);
      expect(lastBody!.remaining).toBe(0);
    });

    it('persists state after allowed hits', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/hit', {
        key: 'persist:test',
        maxRequests: 10,
        windowMs: 60000,
      }));

      expect(state.storage.put).toHaveBeenCalledWith('data', expect.anything());
    });

    it('does not persist when hit is denied', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await doInstance.fetch(postJSON('/hit', {
          key: 'nopersist',
          maxRequests: 3,
          windowMs: 60000,
        }));
      }

      state.storage.put.mockClear();

      // This hit should be denied - no persist
      await doInstance.fetch(postJSON('/hit', {
        key: 'nopersist',
        maxRequests: 3,
        windowMs: 60000,
      }));

      // put should not have been called again for a denied hit
      expect(state.storage.put).not.toHaveBeenCalled();
    });
  });

  describe('/hit (token_bucket)', () => {
    it('allows requests with token_bucket algorithm', async () => {
      const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'tb:hit',
        maxRequests: 5,
        windowMs: 60000,
        algorithm: 'token_bucket',
      })));

      expect(body.allowed).toBe(true);
      expect(body.algorithm).toBe('token_bucket');
    });

    it('denies when token bucket is empty', async () => {
      const { doInstance } = createDO();

      let lastBody;
      for (let i = 0; i < 6; i++) {
        lastBody = await jsonBody(await doInstance.fetch(postJSON('/hit', {
          key: 'tb:exhaust',
          maxRequests: 5,
          windowMs: 60000,
          algorithm: 'token_bucket',
        })));
      }

      expect(lastBody!.allowed).toBe(false);
    });

    it('cleans up sliding_window entries when using token_bucket', async () => {
      const { doInstance } = createDO();

      // First, create a sliding window entry
      await doInstance.fetch(postJSON('/hit', {
        key: 'cleanup:key',
        maxRequests: 5,
        windowMs: 60000,
      }));

      // Now hit with token_bucket
      await doInstance.fetch(postJSON('/hit', {
        key: 'cleanup:key',
        maxRequests: 5,
        windowMs: 60000,
        algorithm: 'token_bucket',
      }));

      // The entries map should have the key removed (replaced by token bucket)
      const entries = (doInstance as unknown as { entries: Map<string, unknown> }).entries;
      expect(entries.has('cleanup:key')).toBe(false);
    });
  });

  describe('/hit (shadow)', () => {
    it('returns shadow results alongside sliding_window', async () => {
      const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'shadow:hit',
        maxRequests: 5,
        windowMs: 60000,
        algorithm: 'shadow',
      })));

      expect(body.algorithm).toBe('sliding_window');
      expect(body.allowed).toBe(true);
      const shadow = body.shadow as Record<string, Record<string, unknown>>;
      expect(shadow.token_bucket).toBeDefined();
      expect(shadow.token_bucket.allowed).toBe(true);
    });
  });

  describe('/reset', () => {
    it('resets rate limit for a key', async () => {
      const { doInstance } = createDO();

      // Hit until exhausted
      for (let i = 0; i < 3; i++) {
        await doInstance.fetch(postJSON('/hit', {
          key: 'reset:test',
          maxRequests: 3,
          windowMs: 60000,
        }));
      }

      // Verify exhausted
      let body = await jsonBody(await doInstance.fetch(postJSON('/check', {
        key: 'reset:test',
        maxRequests: 3,
        windowMs: 60000,
      })));
      expect(body.remaining).toBe(0);

      // Reset
      const resetRes = await doInstance.fetch(postJSON('/reset', { key: 'reset:test' }));
      body = await jsonBody(resetRes);
      expect(body.success).toBe(true);

      // Verify reset
      body = await jsonBody(await doInstance.fetch(postJSON('/check', {
        key: 'reset:test',
        maxRequests: 3,
        windowMs: 60000,
      })));
      expect(body.remaining).toBe(3);
    });

    it('resets token bucket entries too', async () => {
      const { doInstance } = createDO();

      // Hit with token_bucket
      await doInstance.fetch(postJSON('/hit', {
        key: 'tb:reset',
        maxRequests: 3,
        windowMs: 60000,
        algorithm: 'token_bucket',
      }));

      // Reset
      await doInstance.fetch(postJSON('/reset', { key: 'tb:reset' }));

      // Check should show full bucket
      const body = await jsonBody(await doInstance.fetch(postJSON('/check', {
        key: 'tb:reset',
        maxRequests: 3,
        windowMs: 60000,
        algorithm: 'token_bucket',
      })));
      expect(body.remaining).toBe(3);
    });
  });

  describe('alarm', () => {
    it('cleans up expired entries and reschedules', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      // Add entries directly to the entries map
      const entries = (doInstance as unknown as { entries: Map<string, number[]> }).entries;
      entries.set('old', [Date.now() - 120_000]); // older than 60s default window
      entries.set('fresh', [Date.now()]);

      await doInstance.alarm();

      // Old entry should be cleaned
      expect(entries.has('old')).toBe(false);
      // Fresh entry should remain
      expect(entries.has('fresh')).toBe(true);

      // Should persist and reschedule since there are remaining entries
      expect(state.storage.put).toHaveBeenCalled();
      expect(state.storage.setAlarm).toHaveBeenCalled();
    });

    it('does not reschedule when no entries remain', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      // Reset mocks from constructor
      state.storage.put.mockClear();
      state.storage.setAlarm.mockClear();

      await doInstance.alarm();

      // No entries, so no persist and no alarm reschedule
      expect(state.storage.put).not.toHaveBeenCalled();
      expect(state.storage.setAlarm).not.toHaveBeenCalled();
    });
  });

  describe('key limit enforcement', () => {
    it('enforces the MAX_KEYS limit on entries map', async () => {
      const { doInstance } = createDO();
      const entries = (doInstance as unknown as { entries: Map<string, number[]> }).entries;

      // Fill up entries to MAX_KEYS
      for (let i = 0; i < 10_001; i++) {
        entries.set(`key-${i}`, [Date.now()]);
      }

      // This hit should trigger checkKeyLimit
      await doInstance.fetch(postJSON('/hit', {
        key: 'trigger',
        maxRequests: 10,
        windowMs: 60000,
      }));

      // After enforcement, size should be at or below MAX_KEYS
      expect(entries.size).toBeLessThanOrEqual(10_001);
    });
  });

  describe('constructor hydration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('restores data from storage on construction', async () => {
      const storage = createMockStorage();
      storage._store.set('data', {
        entries: {
          'existing-key': { timestamps: [Date.now()] },
        },
        tokenBuckets: {},
      });

      const state = createMockState(storage);
      const doInstance = new RateLimiterDO(state as unknown as DurableObjectState);

      // Check that existing-key is loaded
      const body = await jsonBody(await doInstance.fetch(postJSON('/check', {
        key: 'existing-key',
        maxRequests: 10,
        windowMs: 60000,
      })));
      expect(body.remaining).toBe(9);
    });

    it('schedules cleanup alarm if not already set', async () => {
      const storage = createMockStorage();
      const state = createMockState(storage);

      new RateLimiterDO(state as unknown as DurableObjectState);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await vi.advanceTimersByTimeAsync(0);

      expect(storage.setAlarm).toHaveBeenCalled();
    });

    it('does not overwrite existing alarm', async () => {
      const storage = createMockStorage();
      // Simulate existing alarm
      storage.getAlarm.mockResolvedValueOnce(Date.now() + 30000);

      const state = createMockState(storage);
      new RateLimiterDO(state as unknown as DurableObjectState);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await vi.advanceTimersByTimeAsync(0);

      // setAlarm should not have been called since one already exists
      expect(storage.setAlarm).not.toHaveBeenCalled();
    });
  });

  describe('blockConcurrencyWhile serialization', () => {
    it('wraps /check in blockConcurrencyWhile', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/check', {
        key: 'test',
        maxRequests: 10,
        windowMs: 60000,
      }));

      // blockConcurrencyWhile is called in constructor + the check handler
      expect(state.blockConcurrencyWhile).toHaveBeenCalledTimes(2);
    });

    it('wraps /hit in blockConcurrencyWhile', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/hit', {
        key: 'test',
        maxRequests: 10,
        windowMs: 60000,
      }));

      // constructor + hit handler
      expect(state.blockConcurrencyWhile).toHaveBeenCalledTimes(2);
    });

    it('wraps /reset in blockConcurrencyWhile', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/reset', { key: 'test' }));

      // constructor + reset handler
      expect(state.blockConcurrencyWhile).toHaveBeenCalledTimes(2);
    });
  });

  describe('default algorithm', () => {
    it('defaults to sliding_window when no algorithm specified', async () => {
      const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'default-algo',
        maxRequests: 10,
        windowMs: 60000,
      })));
      expect(body.algorithm).toBe('sliding_window');
    });
  });

  describe('edge cases', () => {
    it('handles zero maxRequests gracefully', async () => {
      const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'zero',
        maxRequests: 0,
        windowMs: 60000,
      })));
      expect(body.allowed).toBe(false);
    });

    it('handles different keys independently', async () => {
      const { doInstance } = createDO();

      // Exhaust key-a
      for (let i = 0; i < 2; i++) {
        await doInstance.fetch(postJSON('/hit', {
          key: 'key-a',
          maxRequests: 2,
          windowMs: 60000,
        }));
      }

      // key-b should still be available
      const body = await jsonBody(await doInstance.fetch(postJSON('/check', {
        key: 'key-b',
        maxRequests: 2,
        windowMs: 60000,
      })));
      expect(body.remaining).toBe(2);
      expect(body.allowed).toBe(true);
    });
  });
});
