import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionDO } from '@/durable-objects/session';

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
  const doInstance = new SessionDO(state as unknown as DurableObjectState);
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

function validSession(overrides: Partial<{ id: string; user_id: string; expires_at: number; created_at: number }> = {}) {
  return {
    id: overrides.id ?? 'sess-1',
    user_id: overrides.user_id ?? 'user-1',
    expires_at: overrides.expires_at ?? (Date.now() + 3600_000),
    created_at: overrides.created_at ?? Date.now(),
  };
}

function validOIDCState(overrides: Partial<{
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  expires_at: number;
  cli_callback: string;
}> = {}) {
  return {
    state: overrides.state ?? 'oidc-state-1',
    nonce: overrides.nonce ?? 'nonce-1',
    code_verifier: overrides.code_verifier ?? 'verifier-1',
    return_to: overrides.return_to ?? 'https://app.test.com/callback',
    expires_at: overrides.expires_at ?? (Date.now() + 600_000),
    ...(overrides.cli_callback ? { cli_callback: overrides.cli_callback } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionDO', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetch routing', () => {
    it('returns 404 for unknown paths', async () => {
      const { doInstance } = createDO();
      const req = postJSON('/unknown', {});
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(404);
    });

    it('returns 500 for internal errors', async () => {
      const storage = createMockStorage();
      const state = createMockState(storage);
      const { doInstance } = createDO(state);

      // Force a JSON parse error by sending invalid body to a known route
      const req = new Request('https://do.internal/session/create', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      expect(res.status).toBe(500);
    });
  });

  describe('/session/create', () => {
    it('creates a new session', async () => {
      const { doInstance, state } = createDO();
      const session = validSession();

      const res = await doInstance.fetch(postJSON('/session/create', { session }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.success).toBe(true);

      // Verify persist was called
      expect(state.storage.put).toHaveBeenCalledWith('data', expect.anything());
    });

    it('returns existing:true if session already exists and not expired', async () => {
      const { doInstance } = createDO();
      const session = validSession({ id: 'existing' });

      // Create first time
      await doInstance.fetch(postJSON('/session/create', { session }));

      // Create again with same ID
      const res = await doInstance.fetch(postJSON('/session/create', { session }));
      const body = await jsonBody(res);
      expect(body.success).toBe(true);
      expect(body.existing).toBe(true);
    });

    it('overwrites expired session with same ID', async () => {
      const { doInstance } = createDO();
      const expiredSession = validSession({ id: 'expired', expires_at: Date.now() - 1000 });

      // Create expired session
      await doInstance.fetch(postJSON('/session/create', { session: expiredSession }));

      // Create new session with same ID
      const newSession = validSession({ id: 'expired' });
      const res = await doInstance.fetch(postJSON('/session/create', { session: newSession }));
      const body = await jsonBody(res);
      expect(body.success).toBe(true);
      expect(body.existing).toBeUndefined();
    });

    it('schedules a cleanup alarm after creation', async () => {
      const { doInstance, state } = createDO();
      const session = validSession();

      await doInstance.fetch(postJSON('/session/create', { session }));

      expect(state.storage.setAlarm).toHaveBeenCalled();
    });

    it('uses blockConcurrencyWhile for serialization', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/session/create', { session: validSession() }));

      // Called in constructor + session/create
      expect(state.blockConcurrencyWhile).toHaveBeenCalledTimes(2);
    });
  });

  describe('/session/get', () => {
    it('returns an existing session', async () => {
      const { doInstance } = createDO();
      const session = validSession({ id: 'get-test' });

      await doInstance.fetch(postJSON('/session/create', { session }));

      const res = await doInstance.fetch(postJSON('/session/get', { sessionId: 'get-test' }));
      const body = await jsonBody(res);
      expect(body.session).not.toBeNull();
      const returned = body.session as Record<string, unknown>;
      expect(returned.id).toBe('get-test');
      expect(returned.user_id).toBe('user-1');
    });

    it('returns null for non-existent session', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/session/get', { sessionId: 'nonexistent' }));
      const body = await jsonBody(res);
      expect(body.session).toBeNull();
    });

    it('returns null and evicts expired session', async () => {
      const { doInstance, state } = createDO();
      const expiredSession = validSession({ id: 'expired', expires_at: Date.now() - 1000 });

      await doInstance.fetch(postJSON('/session/create', { session: expiredSession }));
      state.storage.put.mockClear();

      const res = await doInstance.fetch(postJSON('/session/get', { sessionId: 'expired' }));
      const body = await jsonBody(res);
      expect(body.session).toBeNull();

      // Should have persisted the eviction
      expect(state.storage.put).toHaveBeenCalled();
    });

    it('does not persist when session is valid', async () => {
      const { doInstance, state } = createDO();
      const session = validSession({ id: 'valid' });

      await doInstance.fetch(postJSON('/session/create', { session }));
      state.storage.put.mockClear();

      await doInstance.fetch(postJSON('/session/get', { sessionId: 'valid' }));

      // No eviction happened, so no persist on get
      expect(state.storage.put).not.toHaveBeenCalled();
    });
  });

  describe('/session/delete', () => {
    it('deletes an existing session', async () => {
      const { doInstance } = createDO();
      const session = validSession({ id: 'delete-me' });

      await doInstance.fetch(postJSON('/session/create', { session }));

      const res = await doInstance.fetch(postJSON('/session/delete', { sessionId: 'delete-me' }));
      const body = await jsonBody(res);
      expect(body.success).toBe(true);

      // Verify it's gone
      const getRes = await doInstance.fetch(postJSON('/session/get', { sessionId: 'delete-me' }));
      const getBody = await jsonBody(getRes);
      expect(getBody.session).toBeNull();
    });

    it('succeeds even if session does not exist', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/session/delete', { sessionId: 'nonexistent' }));
      const body = await jsonBody(res);
      expect(body.success).toBe(true);
    });
  });

  describe('/oidc-state/create', () => {
    it('creates a new OIDC state', async () => {
      const { doInstance, state } = createDO();
      const oidcState = validOIDCState();

      const res = await doInstance.fetch(postJSON('/oidc-state/create', { oidcState }));
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.success).toBe(true);
      expect(state.storage.put).toHaveBeenCalled();
    });

    it('schedules cleanup alarm', async () => {
      const { doInstance, state } = createDO();
      const oidcState = validOIDCState();

      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState }));
      expect(state.storage.setAlarm).toHaveBeenCalled();
    });
  });

  describe('/oidc-state/get', () => {
    it('returns an existing OIDC state', async () => {
      const { doInstance } = createDO();
      const oidcState = validOIDCState({ state: 'oidc-get' });

      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState }));

      const res = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'oidc-get' }));
      const body = await jsonBody(res);
      expect(body.oidcState).not.toBeNull();
      const returned = body.oidcState as Record<string, unknown>;
      expect(returned.state).toBe('oidc-get');
      expect(returned.nonce).toBe('nonce-1');
    });

    it('returns null for non-existent OIDC state', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'nonexistent' }));
      const body = await jsonBody(res);
      expect(body.oidcState).toBeNull();
    });

    it('returns null and evicts expired OIDC state', async () => {
      const { doInstance, state } = createDO();
      const expiredState = validOIDCState({ state: 'expired-oidc', expires_at: Date.now() - 1000 });

      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState: expiredState }));
      state.storage.put.mockClear();

      const res = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'expired-oidc' }));
      const body = await jsonBody(res);
      expect(body.oidcState).toBeNull();

      // Eviction should trigger persist
      expect(state.storage.put).toHaveBeenCalled();
    });
  });

  describe('/oidc-state/delete', () => {
    it('deletes an existing OIDC state', async () => {
      const { doInstance } = createDO();
      const oidcState = validOIDCState({ state: 'delete-oidc' });

      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState }));
      const res = await doInstance.fetch(postJSON('/oidc-state/delete', { state: 'delete-oidc' }));
      const body = await jsonBody(res);
      expect(body.success).toBe(true);

      // Verify it's gone
      const getRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'delete-oidc' }));
      const getBody = await jsonBody(getRes);
      expect(getBody.oidcState).toBeNull();
    });

    it('succeeds even if state does not exist', async () => {
      const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/oidc-state/delete', { state: 'nonexistent' }));
      const body = await jsonBody(res);
      expect(body.success).toBe(true);
    });
  });

  describe('alarm', () => {
    it('evicts expired sessions', async () => {
      const { doInstance, state } = createDO();

      // Create expired and valid sessions
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'expired-sess', expires_at: Date.now() - 1000 }),
      }));
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'valid-sess' }),
      }));

      state.storage.put.mockClear();
      await doInstance.alarm();

      // Expired should be gone, valid should remain
      const expiredRes = await doInstance.fetch(postJSON('/session/get', { sessionId: 'expired-sess' }));
      expect((await jsonBody(expiredRes)).session).toBeNull();

      const validRes = await doInstance.fetch(postJSON('/session/get', { sessionId: 'valid-sess' }));
      expect((await jsonBody(validRes)).session).not.toBeNull();

      // Should have persisted the eviction
      expect(state.storage.put).toHaveBeenCalled();
    });

    it('evicts expired OIDC states', async () => {
      const { doInstance, state } = createDO();

      await doInstance.fetch(postJSON('/oidc-state/create', {
        oidcState: validOIDCState({ state: 'expired-oidc', expires_at: Date.now() - 1000 }),
      }));
      await doInstance.fetch(postJSON('/oidc-state/create', {
        oidcState: validOIDCState({ state: 'valid-oidc' }),
      }));

      state.storage.put.mockClear();
      await doInstance.alarm();

      const expiredRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'expired-oidc' }));
      expect((await jsonBody(expiredRes)).oidcState).toBeNull();

      const validRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'valid-oidc' }));
      expect((await jsonBody(validRes)).oidcState).not.toBeNull();
    });

    it('does not persist when nothing is evicted', async () => {
      const { doInstance, state } = createDO();

      // Create a valid session
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'valid-only' }),
      }));

      state.storage.put.mockClear();
      await doInstance.alarm();

      // No eviction, so persist should not be called from alarm
      expect(state.storage.put).not.toHaveBeenCalled();
    });

    it('reschedules alarm based on earliest expiry', async () => {
      const { doInstance, state } = createDO();
      const soonExpiry = Date.now() + 5000;

      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'soon', expires_at: soonExpiry }),
      }));
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'later', expires_at: Date.now() + 3600_000 }),
      }));

      // Clear alarm from create
      state.storage.getAlarm.mockResolvedValueOnce(null);
      state.storage.setAlarm.mockClear();

      await doInstance.alarm();

      // Alarm should be scheduled at or after the earliest expiry
      expect(state.storage.setAlarm).toHaveBeenCalled();
      const alarmTime = state.storage.setAlarm.mock.calls[0][0] as number;
      expect(alarmTime).toBeGreaterThanOrEqual(soonExpiry);
    });

    it('does not reschedule alarm when no entries exist', async () => {
      const { doInstance, state } = createDO();
      state.storage.setAlarm.mockClear();

      await doInstance.alarm();

      // No entries, getAlarm returns null (default), so no alarm scheduling
      // because earliestExpiry is Infinity
      expect(state.storage.setAlarm).not.toHaveBeenCalled();
    });
  });

  describe('constructor hydration', () => {
    it('restores sessions and OIDC states from storage', async () => {
      const storage = createMockStorage();
      storage._store.set('data', {
        sessions: {
          'sess-1': validSession({ id: 'sess-1' }),
        },
        oidcStates: {
          'oidc-1': validOIDCState({ state: 'oidc-1' }),
        },
      });

      const state = createMockState(storage);
      const doInstance = new SessionDO(state as unknown as DurableObjectState);

      // Verify session is restored
      const sessRes = await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-1' }));
      expect((await jsonBody(sessRes)).session).not.toBeNull();

      // Verify OIDC state is restored
      const oidcRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'oidc-1' }));
      expect((await jsonBody(oidcRes)).oidcState).not.toBeNull();
    });

    it('handles missing stored data gracefully', async () => {
      const storage = createMockStorage();
      // No data in storage
      const state = createMockState(storage);
      const doInstance = new SessionDO(state as unknown as DurableObjectState);

      const res = await doInstance.fetch(postJSON('/session/get', { sessionId: 'nonexistent' }));
      expect((await jsonBody(res)).session).toBeNull();
    });

    it('handles partial stored data (missing oidcStates)', async () => {
      const storage = createMockStorage();
      storage._store.set('data', {
        sessions: { 'sess-1': validSession({ id: 'sess-1' }) },
      });

      const state = createMockState(storage);
      const doInstance = new SessionDO(state as unknown as DurableObjectState);

      const sessRes = await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-1' }));
      expect((await jsonBody(sessRes)).session).not.toBeNull();

      // OIDC states should be empty, not crash
      const oidcRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'anything' }));
      expect((await jsonBody(oidcRes)).oidcState).toBeNull();
    });
  });

  describe('multiple sessions lifecycle', () => {
    it('manages multiple sessions independently', async () => {
      const { doInstance } = createDO();

      // Create multiple sessions
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'sess-a', user_id: 'user-a' }),
      }));
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'sess-b', user_id: 'user-b' }),
      }));

      // Get both
      const resA = await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-a' }));
      const resB = await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-b' }));
      expect((await jsonBody(resA)).session).not.toBeNull();
      expect((await jsonBody(resB)).session).not.toBeNull();

      // Delete one
      await doInstance.fetch(postJSON('/session/delete', { sessionId: 'sess-a' }));

      // A is gone, B remains
      const afterA = await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-a' }));
      const afterB = await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-b' }));
      expect((await jsonBody(afterA)).session).toBeNull();
      expect((await jsonBody(afterB)).session).not.toBeNull();
    });
  });

  describe('concurrency control', () => {
    it('wraps all mutating operations in blockConcurrencyWhile', async () => {
      const state = createMockState();
      const { doInstance } = createDO(state);

      // constructor = 1 call
      const initialCalls = state.blockConcurrencyWhile.mock.calls.length;

      // Each operation should add one blockConcurrencyWhile call
      await doInstance.fetch(postJSON('/session/create', { session: validSession() }));
      await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-1' }));
      await doInstance.fetch(postJSON('/session/delete', { sessionId: 'sess-1' }));
      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState: validOIDCState() }));
      await doInstance.fetch(postJSON('/oidc-state/get', { state: 'oidc-state-1' }));
      await doInstance.fetch(postJSON('/oidc-state/delete', { state: 'oidc-state-1' }));

      // 6 operations after constructor
      expect(state.blockConcurrencyWhile.mock.calls.length).toBe(initialCalls + 6);
    });
  });
});
