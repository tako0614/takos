import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitPushLockDO } from '@/durable-objects/git-push-lock';

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
    // expose raw store for assertions
    _store: store,
    _getAlarm: () => alarm,
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

describe('GitPushLockDO', () => {
  describe('fetch routing', () => {
    it('returns 405 for non-POST methods', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/acquire', { method: 'GET' });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(405);
      const body = await jsonBody(res);
      expect(body.error).toBe('Method not allowed');
    });

    it('returns 404 for unknown paths', async () => {
      const { doInstance } = createDO();
      const req = postJSON('/unknown');
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(404);
      const body = await jsonBody(res);
      expect(body.error).toBe('Not found');
    });
  });

  describe('/acquire', () => {
    it('acquires a lock successfully when no existing lock', async () => {
      const { doInstance, state } = createDO();
      const res = await doInstance.fetch(postJSON('/acquire', { token: 'abc' }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.ok).toBe(true);
      expect(body.token).toBe('abc');
      expect(body.expires_at).toBeTypeOf('number');

      // Verify storage was written
      expect(state.storage.put).toHaveBeenCalled();
      // Verify alarm was scheduled
      expect(state.storage.setAlarm).toHaveBeenCalled();
    });

    it('generates a UUID token when none is provided', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/acquire', {}));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.ok).toBe(true);
      expect(body.token).toBeTypeOf('string');
      expect((body.token as string).length).toBeGreaterThan(0);
    });

    it('generates a UUID token when token is empty string', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/acquire', { token: '' }));
      const body = await jsonBody(res);
      expect(body.ok).toBe(true);
      // Should be a UUID, not empty string
      expect((body.token as string).length).toBeGreaterThan(0);
    });

    it('returns 409 when lock is already held and not expired', async () => {
      const { doInstance } = createDO();

      // Acquire first lock
      const res1 = await doInstance.fetch(postJSON('/acquire', { token: 'first' }));
      expect(res1.status).toBe(200);

      // Try to acquire again
      const res2 = await doInstance.fetch(postJSON('/acquire', { token: 'second' }));
      expect(res2.status).toBe(409);

      const body = await jsonBody(res2);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('push already in progress');
      expect(body.expires_at).toBeTypeOf('number');
    });

    it('allows re-acquiring after previous lock expires', async () => {
      const storage = createMockStorage();
      const mockState = createMockState(storage);
      const { doInstance } = createDO(mockState);

      // Simulate an expired lock in storage
      storage._store.set('lock', { token: 'old', expiresAt: Date.now() - 1000 });

      const res = await doInstance.fetch(postJSON('/acquire', { token: 'new' }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.ok).toBe(true);
      expect(body.token).toBe('new');
    });

    it('clamps leaseMs to minimum of 1000', async () => {
      const { doInstance } = createDO();
      const now = Date.now();

      const res = await doInstance.fetch(postJSON('/acquire', { token: 'x', leaseMs: 100 }));
      const body = await jsonBody(res);
      expect(body.ok).toBe(true);
      // expiresAt should be at least now + 1000 (minimum lease)
      expect(body.expires_at as number).toBeGreaterThanOrEqual(now + 1000);
    });

    it('clamps leaseMs to maximum of 5 minutes', async () => {
      const { doInstance } = createDO();
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      const res = await doInstance.fetch(postJSON('/acquire', { token: 'x', leaseMs: 10 * 60 * 1000 }));
      const body = await jsonBody(res);
      expect(body.ok).toBe(true);
      // expires_at should be roughly now + 5 minutes (capped)
      expect(body.expires_at as number).toBeLessThanOrEqual(now + fiveMinutes + 100);
    });

    it('handles malformed JSON body gracefully', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/acquire', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      // With malformed JSON, token defaults to a generated UUID
      expect(body.ok).toBe(true);
      expect(body.token).toBeTypeOf('string');
    });

    it('uses blockConcurrencyWhile for serialization', async () => {
      const mockState = createMockState();
      const { doInstance } = createDO(mockState);

      await doInstance.fetch(postJSON('/acquire', { token: 'test' }));
      expect(mockState.blockConcurrencyWhile).toHaveBeenCalled();
    });
  });

  describe('/release', () => {
    it('releases a held lock with matching token', async () => {
      const { doInstance, state } = createDO();

      // Acquire lock
      await doInstance.fetch(postJSON('/acquire', { token: 'mytoken' }));

      // Release it
      const res = await doInstance.fetch(postJSON('/release', { token: 'mytoken' }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.ok).toBe(true);
      expect(body.released).toBe(true);

      // Lock should be deleted from storage
      expect(state.storage.delete).toHaveBeenCalledWith('lock');
      // Alarm should be deleted
      expect(state.storage.deleteAlarm).toHaveBeenCalled();
    });

    it('returns released:false when no lock exists', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/release', { token: 'nolock' }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.ok).toBe(true);
      expect(body.released).toBe(false);
    });

    it('returns 409 when token does not match', async () => {
      const { doInstance } = createDO();

      // Acquire lock
      await doInstance.fetch(postJSON('/acquire', { token: 'correct' }));

      // Try to release with wrong token
      const res = await doInstance.fetch(postJSON('/release', { token: 'wrong' }));
      expect(res.status).toBe(409);

      const body = await jsonBody(res);
      expect(body.error).toBe('lock token mismatch');
    });

    it('returns 400 when token is missing', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/release', {}));
      expect(res.status).toBe(400);

      const body = await jsonBody(res);
      expect(body.error).toBe('token is required');
    });

    it('returns 400 when token is empty string', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/release', { token: '' }));
      expect(res.status).toBe(400);

      const body = await jsonBody(res);
      expect(body.error).toBe('token is required');
    });

    it('returns 400 when token is not a string', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/release', { token: 123 }));
      expect(res.status).toBe(400);
    });

    it('handles malformed JSON body in release', async () => {
      const { doInstance } = createDO();
      const req = new Request('https://do.internal/release', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(400);
    });
  });

  describe('alarm', () => {
    it('clears expired lock on alarm', async () => {
      const storage = createMockStorage();
      const mockState = createMockState(storage);
      const { doInstance } = createDO(mockState);

      // Set an expired lock
      storage._store.set('lock', { token: 'expired', expiresAt: Date.now() - 1000 });

      await doInstance.alarm();

      expect(storage.delete).toHaveBeenCalledWith('lock');
    });

    it('re-schedules alarm if lock is still active', async () => {
      const storage = createMockStorage();
      const mockState = createMockState(storage);
      const { doInstance } = createDO(mockState);

      const futureExpiry = Date.now() + 60_000;
      storage._store.set('lock', { token: 'active', expiresAt: futureExpiry });

      await doInstance.alarm();

      expect(storage.delete).not.toHaveBeenCalledWith('lock');
      expect(storage.setAlarm).toHaveBeenCalledWith(futureExpiry);
    });

    it('does nothing when no lock exists', async () => {
      const storage = createMockStorage();
      const mockState = createMockState(storage);
      const { doInstance } = createDO(mockState);

      await doInstance.alarm();

      expect(storage.delete).not.toHaveBeenCalled();
      expect(storage.setAlarm).not.toHaveBeenCalled();
    });
  });

  describe('acquire/release lifecycle', () => {
    it('supports full acquire-release-reacquire cycle', async () => {
      const { doInstance } = createDO();

      // Acquire
      const r1 = await jsonBody(await doInstance.fetch(postJSON('/acquire', { token: 'a' })));
      expect(r1.ok).toBe(true);

      // Release
      const r2 = await jsonBody(await doInstance.fetch(postJSON('/release', { token: 'a' })));
      expect(r2.ok).toBe(true);
      expect(r2.released).toBe(true);

      // Reacquire
      const r3 = await jsonBody(await doInstance.fetch(postJSON('/acquire', { token: 'b' })));
      expect(r3.ok).toBe(true);
      expect(r3.token).toBe('b');
    });

    it('prevents concurrent pushes', async () => {
      const { doInstance } = createDO();

      // First push acquires lock
      const r1 = await doInstance.fetch(postJSON('/acquire', { token: 'push1' }));
      expect(r1.status).toBe(200);

      // Second push is rejected
      const r2 = await doInstance.fetch(postJSON('/acquire', { token: 'push2' }));
      expect(r2.status).toBe(409);

      // Third push with different token also rejected
      const r3 = await doInstance.fetch(postJSON('/acquire', { token: 'push3' }));
      expect(r3.status).toBe(409);

      // Release first lock
      const r4 = await doInstance.fetch(postJSON('/release', { token: 'push1' }));
      expect(r4.status).toBe(200);

      // Now second push can acquire
      const r5 = await doInstance.fetch(postJSON('/acquire', { token: 'push2' }));
      expect(r5.status).toBe(200);
    });
  });
});
