import { GitPushLockDO } from '@/durable-objects/git-push-lock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

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
    // expose raw store for assertions
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
  const doInstance = new GitPushLockDO(state as unknown as DurableObjectState);
  return { doInstance, state };
}

function postJSON(path: string, body: Record<string, unknown> = {}): Request {
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


  
    Deno.test('GitPushLockDO - fetch routing - returns 405 for non-POST methods', async () => {
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/acquire', { method: 'GET' });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 405);
      const body = await jsonBody(res);
      assertEquals(body.error, 'Method not allowed');
})
    Deno.test('GitPushLockDO - fetch routing - returns 404 for unknown paths', async () => {
  const { doInstance } = createDO();
      const req = postJSON('/unknown');
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 404);
      const body = await jsonBody(res);
      assertEquals(body.error, 'Not found');
})  
  
    Deno.test('GitPushLockDO - /acquire - acquires a lock successfully when no existing lock', async () => {
  const { doInstance, state } = createDO();
      const res = await doInstance.fetch(postJSON('/acquire', { token: 'abc' }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.ok, true);
      assertEquals(body.token, 'abc');
      assertEquals(typeof body.expires_at, 'number');

      // Verify storage was written
      assert(state.storage.put.calls.length > 0);
      // Verify alarm was scheduled
      assert(state.storage.setAlarm.calls.length > 0);
})
    Deno.test('GitPushLockDO - /acquire - generates a UUID token when none is provided', async () => {
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/acquire', {}));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.ok, true);
      assertEquals(typeof body.token, 'string');
      assert((body.token as string).length > 0);
})
    Deno.test('GitPushLockDO - /acquire - generates a UUID token when token is empty string', async () => {
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/acquire', { token: '' }));
      const body = await jsonBody(res);
      assertEquals(body.ok, true);
      // Should be a UUID, not empty string
      assert((body.token as string).length > 0);
})
    Deno.test('GitPushLockDO - /acquire - returns 409 when lock is already held and not expired', async () => {
  const { doInstance } = createDO();

      // Acquire first lock
      const res1 = await doInstance.fetch(postJSON('/acquire', { token: 'first' }));
      assertEquals(res1.status, 200);

      // Try to acquire again
      const res2 = await doInstance.fetch(postJSON('/acquire', { token: 'second' }));
      assertEquals(res2.status, 409);

      const body = await jsonBody(res2);
      assertEquals(body.ok, false);
      assertStringIncludes(body.error, 'push already in progress');
      assertEquals(typeof body.expires_at, 'number');
})
    Deno.test('GitPushLockDO - /acquire - allows re-acquiring after previous lock expires', async () => {
  const storage = createMockStorage();
      const mockState = createMockState(storage);
      const { doInstance } = createDO(mockState);

      // Simulate an expired lock in storage
      storage._store.set('lock', { token: 'old', expiresAt: Date.now() - 1000 });

      const res = await doInstance.fetch(postJSON('/acquire', { token: 'new' }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.ok, true);
      assertEquals(body.token, 'new');
})
    Deno.test('GitPushLockDO - /acquire - clamps leaseMs to minimum of 1000', async () => {
  const { doInstance } = createDO();
      const now = Date.now();

      const res = await doInstance.fetch(postJSON('/acquire', { token: 'x', leaseMs: 100 }));
      const body = await jsonBody(res);
      assertEquals(body.ok, true);
      // expiresAt should be at least now + 1000 (minimum lease)
      assert(body.expires_at as number >= now + 1000);
})
    Deno.test('GitPushLockDO - /acquire - clamps leaseMs to maximum of 5 minutes', async () => {
  const { doInstance } = createDO();
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      const res = await doInstance.fetch(postJSON('/acquire', { token: 'x', leaseMs: 10 * 60 * 1000 }));
      const body = await jsonBody(res);
      assertEquals(body.ok, true);
      // expires_at should be roughly now + 5 minutes (capped)
      assert(body.expires_at as number <= now + fiveMinutes + 100);
})
    Deno.test('GitPushLockDO - /acquire - handles malformed JSON body gracefully', async () => {
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/acquire', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 200);
      const body = await jsonBody(res);
      // With malformed JSON, token defaults to a generated UUID
      assertEquals(body.ok, true);
      assertEquals(typeof body.token, 'string');
})
    Deno.test('GitPushLockDO - /acquire - uses blockConcurrencyWhile for serialization', async () => {
  const mockState = createMockState();
      const { doInstance } = createDO(mockState);

      await doInstance.fetch(postJSON('/acquire', { token: 'test' }));
      assert(mockState.blockConcurrencyWhile.calls.length > 0);
})  
  
    Deno.test('GitPushLockDO - /release - releases a held lock with matching token', async () => {
  const { doInstance, state } = createDO();

      // Acquire lock
      await doInstance.fetch(postJSON('/acquire', { token: 'mytoken' }));

      // Release it
      const res = await doInstance.fetch(postJSON('/release', { token: 'mytoken' }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.ok, true);
      assertEquals(body.released, true);

      // Lock should be deleted from storage
      assertSpyCallArgs(state.storage.delete, 0, ['lock']);
      // Alarm should be deleted
      assert(state.storage.deleteAlarm.calls.length > 0);
})
    Deno.test('GitPushLockDO - /release - returns released:false when no lock exists', async () => {
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/release', { token: 'nolock' }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.ok, true);
      assertEquals(body.released, false);
})
    Deno.test('GitPushLockDO - /release - returns 409 when token does not match', async () => {
  const { doInstance } = createDO();

      // Acquire lock
      await doInstance.fetch(postJSON('/acquire', { token: 'correct' }));

      // Try to release with wrong token
      const res = await doInstance.fetch(postJSON('/release', { token: 'wrong' }));
      assertEquals(res.status, 409);

      const body = await jsonBody(res);
      assertEquals(body.error, 'lock token mismatch');
})
    Deno.test('GitPushLockDO - /release - returns 400 when token is missing', async () => {
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/release', {}));
      assertEquals(res.status, 400);

      const body = await jsonBody(res);
      assertEquals(body.error, 'token is required');
})
    Deno.test('GitPushLockDO - /release - returns 400 when token is empty string', async () => {
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/release', { token: '' }));
      assertEquals(res.status, 400);

      const body = await jsonBody(res);
      assertEquals(body.error, 'token is required');
})
    Deno.test('GitPushLockDO - /release - returns 400 when token is not a string', async () => {
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/release', { token: 123 }));
      assertEquals(res.status, 400);
})
    Deno.test('GitPushLockDO - /release - handles malformed JSON body in release', async () => {
  const { doInstance } = createDO();
      const req = new Request('https://do.internal/release', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 400);
})  
  
    Deno.test('GitPushLockDO - alarm - clears expired lock on alarm', async () => {
  const storage = createMockStorage();
      const mockState = createMockState(storage);
      const { doInstance } = createDO(mockState);

      // Set an expired lock
      storage._store.set('lock', { token: 'expired', expiresAt: Date.now() - 1000 });

      await doInstance.alarm();

      assertSpyCallArgs(storage.delete, 0, ['lock']);
})
    Deno.test('GitPushLockDO - alarm - re-schedules alarm if lock is still active', async () => {
  const storage = createMockStorage();
      const mockState = createMockState(storage);
      const { doInstance } = createDO(mockState);

      const futureExpiry = Date.now() + 60_000;
      storage._store.set('lock', { token: 'active', expiresAt: futureExpiry });

      await doInstance.alarm();

      // TODO: manual assertion - storage.delete was not called with ('lock');
      assertSpyCallArgs(storage.setAlarm, 0, [futureExpiry]);
})
    Deno.test('GitPushLockDO - alarm - does nothing when no lock exists', async () => {
  const storage = createMockStorage();
      const mockState = createMockState(storage);
      const { doInstance } = createDO(mockState);

      await doInstance.alarm();

      assertSpyCalls(storage.delete, 0);
      assertSpyCalls(storage.setAlarm, 0);
})  
  
    Deno.test('GitPushLockDO - acquire/release lifecycle - supports full acquire-release-reacquire cycle', async () => {
  const { doInstance } = createDO();

      // Acquire
      const r1 = await jsonBody(await doInstance.fetch(postJSON('/acquire', { token: 'a' })));
      assertEquals(r1.ok, true);

      // Release
      const r2 = await jsonBody(await doInstance.fetch(postJSON('/release', { token: 'a' })));
      assertEquals(r2.ok, true);
      assertEquals(r2.released, true);

      // Reacquire
      const r3 = await jsonBody(await doInstance.fetch(postJSON('/acquire', { token: 'b' })));
      assertEquals(r3.ok, true);
      assertEquals(r3.token, 'b');
})
    Deno.test('GitPushLockDO - acquire/release lifecycle - prevents concurrent pushes', async () => {
  const { doInstance } = createDO();

      // First push acquires lock
      const r1 = await doInstance.fetch(postJSON('/acquire', { token: 'push1' }));
      assertEquals(r1.status, 200);

      // Second push is rejected
      const r2 = await doInstance.fetch(postJSON('/acquire', { token: 'push2' }));
      assertEquals(r2.status, 409);

      // Third push with different token also rejected
      const r3 = await doInstance.fetch(postJSON('/acquire', { token: 'push3' }));
      assertEquals(r3.status, 409);

      // Release first lock
      const r4 = await doInstance.fetch(postJSON('/release', { token: 'push1' }));
      assertEquals(r4.status, 200);

      // Now second push can acquire
      const r5 = await doInstance.fetch(postJSON('/acquire', { token: 'push2' }));
      assertEquals(r5.status, 200);
})  