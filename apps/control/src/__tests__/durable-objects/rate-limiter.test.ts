import { RateLimiterDO } from '@/durable-objects/rate-limiter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assertEquals, assert } from 'jsr:@std/assert';
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


  
    Deno.test('RateLimiterDO - fetch routing - returns 404 for unknown paths', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/unknown', { method: 'POST' });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 404);
})
    Deno.test('RateLimiterDO - fetch routing - returns 404 for GET on /check', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/check', { method: 'GET' });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 404);
})
    Deno.test('RateLimiterDO - fetch routing - returns 500 for malformed JSON', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/check', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 500);
})  
  
    Deno.test('RateLimiterDO - /check (sliding_window) - returns allowed=true within rate limit', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/check', {
        key: 'user:1',
        maxRequests: 10,
        windowMs: 60000,
      }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.allowed, true);
      assertEquals(body.remaining, 10);
      assertEquals(body.total, 10);
      assertEquals(body.algorithm, 'sliding_window');
})
    Deno.test('RateLimiterDO - /check (sliding_window) - returns correct remaining count after hits', async () => {
  /* TODO: restore mocks manually */ void 0;
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
      assertEquals(body.remaining, 2);
})  
  
    Deno.test('RateLimiterDO - /check (token_bucket) - returns allowed=true with full bucket', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/check', {
        key: 'user:tb',
        maxRequests: 10,
        windowMs: 60000,
        algorithm: 'token_bucket',
      }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.allowed, true);
      assertEquals(body.remaining, 10);
      assertEquals(body.algorithm, 'token_bucket');
})  
  
    Deno.test('RateLimiterDO - /check (shadow) - returns both sliding_window and shadow token_bucket results', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/check', {
        key: 'user:shadow',
        maxRequests: 10,
        windowMs: 60000,
        algorithm: 'shadow',
      }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.algorithm, 'sliding_window');
      assert(body.shadow !== undefined);
      const shadow = body.shadow as Record<string, Record<string, unknown>>;
      assert(shadow.token_bucket !== undefined);
      assertEquals(shadow.token_bucket.allowed, true);
})  
  
    Deno.test('RateLimiterDO - /hit (sliding_window) - allows requests within limit', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'hit:1',
        maxRequests: 5,
        windowMs: 60000,
      })));

      assertEquals(body.allowed, true);
      assertEquals(body.remaining, 4);
      assertEquals(body.algorithm, 'sliding_window');
})
    Deno.test('RateLimiterDO - /hit (sliding_window) - denies requests when limit is exhausted', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();

      let lastBody;
      for (let i = 0; i < 6; i++) {
        lastBody = await jsonBody(await doInstance.fetch(postJSON('/hit', {
          key: 'hit:limit',
          maxRequests: 5,
          windowMs: 60000,
        })));
      }

      assertEquals(lastBody!.allowed, false);
      assertEquals(lastBody!.remaining, 0);
})
    Deno.test('RateLimiterDO - /hit (sliding_window) - persists state after allowed hits', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/hit', {
        key: 'persist:test',
        maxRequests: 10,
        windowMs: 60000,
      }));

      assertSpyCallArgs(state.storage.put, 0, ['data', expect.anything()]);
})
    Deno.test('RateLimiterDO - /hit (sliding_window) - does not persist when hit is denied', async () => {
  /* TODO: restore mocks manually */ void 0;
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

      state.storage.put;

      // This hit should be denied - no persist
      await doInstance.fetch(postJSON('/hit', {
        key: 'nopersist',
        maxRequests: 3,
        windowMs: 60000,
      }));

      // put should not have been called again for a denied hit
      assertSpyCalls(state.storage.put, 0);
})  
  
    Deno.test('RateLimiterDO - /hit (token_bucket) - allows requests with token_bucket algorithm', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'tb:hit',
        maxRequests: 5,
        windowMs: 60000,
        algorithm: 'token_bucket',
      })));

      assertEquals(body.allowed, true);
      assertEquals(body.algorithm, 'token_bucket');
})
    Deno.test('RateLimiterDO - /hit (token_bucket) - denies when token bucket is empty', async () => {
  /* TODO: restore mocks manually */ void 0;
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

      assertEquals(lastBody!.allowed, false);
})
    Deno.test('RateLimiterDO - /hit (token_bucket) - cleans up sliding_window entries when using token_bucket', async () => {
  /* TODO: restore mocks manually */ void 0;
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
      assertEquals(entries.has('cleanup:key'), false);
})  
  
    Deno.test('RateLimiterDO - /hit (shadow) - returns shadow results alongside sliding_window', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'shadow:hit',
        maxRequests: 5,
        windowMs: 60000,
        algorithm: 'shadow',
      })));

      assertEquals(body.algorithm, 'sliding_window');
      assertEquals(body.allowed, true);
      const shadow = body.shadow as Record<string, Record<string, unknown>>;
      assert(shadow.token_bucket !== undefined);
      assertEquals(shadow.token_bucket.allowed, true);
})  
  
    Deno.test('RateLimiterDO - /reset - resets rate limit for a key', async () => {
  /* TODO: restore mocks manually */ void 0;
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
      assertEquals(body.remaining, 0);

      // Reset
      const resetRes = await doInstance.fetch(postJSON('/reset', { key: 'reset:test' }));
      body = await jsonBody(resetRes);
      assertEquals(body.success, true);

      // Verify reset
      body = await jsonBody(await doInstance.fetch(postJSON('/check', {
        key: 'reset:test',
        maxRequests: 3,
        windowMs: 60000,
      })));
      assertEquals(body.remaining, 3);
})
    Deno.test('RateLimiterDO - /reset - resets token bucket entries too', async () => {
  /* TODO: restore mocks manually */ void 0;
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
      assertEquals(body.remaining, 3);
})  
  
    Deno.test('RateLimiterDO - alarm - cleans up expired entries and reschedules', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      // Add entries directly to the entries map
      const entries = (doInstance as unknown as { entries: Map<string, number[]> }).entries;
      entries.set('old', [Date.now() - 120_000]); // older than 60s default window
      entries.set('fresh', [Date.now()]);

      await doInstance.alarm();

      // Old entry should be cleaned
      assertEquals(entries.has('old'), false);
      // Fresh entry should remain
      assertEquals(entries.has('fresh'), true);

      // Should persist and reschedule since there are remaining entries
      assert(state.storage.put.calls.length > 0);
      assert(state.storage.setAlarm.calls.length > 0);
})
    Deno.test('RateLimiterDO - alarm - does not reschedule when no entries remain', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      // Reset mocks from constructor
      state.storage.put;
      state.storage.setAlarm;

      await doInstance.alarm();

      // No entries, so no persist and no alarm reschedule
      assertSpyCalls(state.storage.put, 0);
      assertSpyCalls(state.storage.setAlarm, 0);
})  
  
    Deno.test('RateLimiterDO - key limit enforcement - enforces the MAX_KEYS limit on entries map', async () => {
  /* TODO: restore mocks manually */ void 0;
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
      assert(entries.size <= 10_001);
})  
  
    Deno.test('RateLimiterDO - constructor hydration - restores data from storage on construction', async () => {
  /* TODO: restore mocks manually */ void 0;
  new FakeTime();
  try {
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
      assertEquals(body.remaining, 9);
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('RateLimiterDO - constructor hydration - schedules cleanup alarm if not already set', async () => {
  /* TODO: restore mocks manually */ void 0;
  new FakeTime();
  try {
  const storage = createMockStorage();
      const state = createMockState(storage);

      new RateLimiterDO(state as unknown as DurableObjectState);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await await fakeTime.tickAsync(0);

      assert(storage.setAlarm.calls.length > 0);
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('RateLimiterDO - constructor hydration - does not overwrite existing alarm', async () => {
  /* TODO: restore mocks manually */ void 0;
  new FakeTime();
  try {
  const storage = createMockStorage();
      // Simulate existing alarm
      storage.getAlarm = (async () => Date.now() + 30000) as any;

      const state = createMockState(storage);
      new RateLimiterDO(state as unknown as DurableObjectState);

      // Flush microtasks from the constructor's floating blockConcurrencyWhile promise
      await await fakeTime.tickAsync(0);

      // setAlarm should not have been called since one already exists
      assertSpyCalls(storage.setAlarm, 0);
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})  
  
    Deno.test('RateLimiterDO - blockConcurrencyWhile serialization - wraps /check in blockConcurrencyWhile', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/check', {
        key: 'test',
        maxRequests: 10,
        windowMs: 60000,
      }));

      // blockConcurrencyWhile is called in constructor + the check handler
      assertSpyCalls(state.blockConcurrencyWhile, 2);
})
    Deno.test('RateLimiterDO - blockConcurrencyWhile serialization - wraps /hit in blockConcurrencyWhile', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/hit', {
        key: 'test',
        maxRequests: 10,
        windowMs: 60000,
      }));

      // constructor + hit handler
      assertSpyCalls(state.blockConcurrencyWhile, 2);
})
    Deno.test('RateLimiterDO - blockConcurrencyWhile serialization - wraps /reset in blockConcurrencyWhile', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/reset', { key: 'test' }));

      // constructor + reset handler
      assertSpyCalls(state.blockConcurrencyWhile, 2);
})  
  
    Deno.test('RateLimiterDO - default algorithm - defaults to sliding_window when no algorithm specified', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'default-algo',
        maxRequests: 10,
        windowMs: 60000,
      })));
      assertEquals(body.algorithm, 'sliding_window');
})  
  
    Deno.test('RateLimiterDO - edge cases - handles zero maxRequests gracefully', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const body = await jsonBody(await doInstance.fetch(postJSON('/hit', {
        key: 'zero',
        maxRequests: 0,
        windowMs: 60000,
      })));
      assertEquals(body.allowed, false);
})
    Deno.test('RateLimiterDO - edge cases - handles different keys independently', async () => {
  /* TODO: restore mocks manually */ void 0;
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
      assertEquals(body.remaining, 2);
      assertEquals(body.allowed, true);
})  