import { SessionDO } from '@/durable-objects/session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';
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


  
    Deno.test('SessionDO - fetch routing - returns 404 for unknown paths', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const req = postJSON('/unknown', {});
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 404);
})
    Deno.test('SessionDO - fetch routing - returns 500 for internal errors', async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
      const state = createMockState(storage);
      const { doInstance } = createDO(state);

      // Force a JSON parse error by sending invalid body to a known route
      const req = new Request('https://do.internal/session/create', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await doInstance.fetch(req);
      assertEquals(res.status, 500);
})  
  
    Deno.test('SessionDO - /session/create - creates a new session', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();
      const session = validSession();

      const res = await doInstance.fetch(postJSON('/session/create', { session }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.success, true);

      // Verify persist was called
      assertSpyCallArgs(state.storage.put, 0, ['data', expect.anything()]);
})
    Deno.test('SessionDO - /session/create - returns existing:true if session already exists and not expired', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const session = validSession({ id: 'existing' });

      // Create first time
      await doInstance.fetch(postJSON('/session/create', { session }));

      // Create again with same ID
      const res = await doInstance.fetch(postJSON('/session/create', { session }));
      const body = await jsonBody(res);
      assertEquals(body.success, true);
      assertEquals(body.existing, true);
})
    Deno.test('SessionDO - /session/create - overwrites expired session with same ID', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const expiredSession = validSession({ id: 'expired', expires_at: Date.now() - 1000 });

      // Create expired session
      await doInstance.fetch(postJSON('/session/create', { session: expiredSession }));

      // Create new session with same ID
      const newSession = validSession({ id: 'expired' });
      const res = await doInstance.fetch(postJSON('/session/create', { session: newSession }));
      const body = await jsonBody(res);
      assertEquals(body.success, true);
      assertEquals(body.existing, undefined);
})
    Deno.test('SessionDO - /session/create - schedules a cleanup alarm after creation', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();
      const session = validSession();

      await doInstance.fetch(postJSON('/session/create', { session }));

      assert(state.storage.setAlarm.calls.length > 0);
})
    Deno.test('SessionDO - /session/create - uses blockConcurrencyWhile for serialization', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      await doInstance.fetch(postJSON('/session/create', { session: validSession() }));

      // Called in constructor + session/create
      assertSpyCalls(state.blockConcurrencyWhile, 2);
})  
  
    Deno.test('SessionDO - /session/get - returns an existing session', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const session = validSession({ id: 'get-test' });

      await doInstance.fetch(postJSON('/session/create', { session }));

      const res = await doInstance.fetch(postJSON('/session/get', { sessionId: 'get-test' }));
      const body = await jsonBody(res);
      assertNotEquals(body.session, null);
      const returned = body.session as Record<string, unknown>;
      assertEquals(returned.id, 'get-test');
      assertEquals(returned.user_id, 'user-1');
})
    Deno.test('SessionDO - /session/get - returns null for non-existent session', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/session/get', { sessionId: 'nonexistent' }));
      const body = await jsonBody(res);
      assertEquals(body.session, null);
})
    Deno.test('SessionDO - /session/get - returns null and evicts expired session', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();
      const expiredSession = validSession({ id: 'expired', expires_at: Date.now() - 1000 });

      await doInstance.fetch(postJSON('/session/create', { session: expiredSession }));
      state.storage.put;

      const res = await doInstance.fetch(postJSON('/session/get', { sessionId: 'expired' }));
      const body = await jsonBody(res);
      assertEquals(body.session, null);

      // Should have persisted the eviction
      assert(state.storage.put.calls.length > 0);
})
    Deno.test('SessionDO - /session/get - does not persist when session is valid', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();
      const session = validSession({ id: 'valid' });

      await doInstance.fetch(postJSON('/session/create', { session }));
      state.storage.put;

      await doInstance.fetch(postJSON('/session/get', { sessionId: 'valid' }));

      // No eviction happened, so no persist on get
      assertSpyCalls(state.storage.put, 0);
})  
  
    Deno.test('SessionDO - /session/delete - deletes an existing session', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const session = validSession({ id: 'delete-me' });

      await doInstance.fetch(postJSON('/session/create', { session }));

      const res = await doInstance.fetch(postJSON('/session/delete', { sessionId: 'delete-me' }));
      const body = await jsonBody(res);
      assertEquals(body.success, true);

      // Verify it's gone
      const getRes = await doInstance.fetch(postJSON('/session/get', { sessionId: 'delete-me' }));
      const getBody = await jsonBody(getRes);
      assertEquals(getBody.session, null);
})
    Deno.test('SessionDO - /session/delete - succeeds even if session does not exist', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/session/delete', { sessionId: 'nonexistent' }));
      const body = await jsonBody(res);
      assertEquals(body.success, true);
})  
  
    Deno.test('SessionDO - /oidc-state/create - creates a new OIDC state', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();
      const oidcState = validOIDCState();

      const res = await doInstance.fetch(postJSON('/oidc-state/create', { oidcState }));
      assertEquals(res.status, 200);

      const body = await jsonBody(res);
      assertEquals(body.success, true);
      assert(state.storage.put.calls.length > 0);
})
    Deno.test('SessionDO - /oidc-state/create - schedules cleanup alarm', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();
      const oidcState = validOIDCState();

      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState }));
      assert(state.storage.setAlarm.calls.length > 0);
})  
  
    Deno.test('SessionDO - /oidc-state/get - returns an existing OIDC state', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const oidcState = validOIDCState({ state: 'oidc-get' });

      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState }));

      const res = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'oidc-get' }));
      const body = await jsonBody(res);
      assertNotEquals(body.oidcState, null);
      const returned = body.oidcState as Record<string, unknown>;
      assertEquals(returned.state, 'oidc-get');
      assertEquals(returned.nonce, 'nonce-1');
})
    Deno.test('SessionDO - /oidc-state/get - returns null for non-existent OIDC state', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'nonexistent' }));
      const body = await jsonBody(res);
      assertEquals(body.oidcState, null);
})
    Deno.test('SessionDO - /oidc-state/get - returns null and evicts expired OIDC state', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();
      const expiredState = validOIDCState({ state: 'expired-oidc', expires_at: Date.now() - 1000 });

      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState: expiredState }));
      state.storage.put;

      const res = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'expired-oidc' }));
      const body = await jsonBody(res);
      assertEquals(body.oidcState, null);

      // Eviction should trigger persist
      assert(state.storage.put.calls.length > 0);
})  
  
    Deno.test('SessionDO - /oidc-state/delete - deletes an existing OIDC state', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const oidcState = validOIDCState({ state: 'delete-oidc' });

      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState }));
      const res = await doInstance.fetch(postJSON('/oidc-state/delete', { state: 'delete-oidc' }));
      const body = await jsonBody(res);
      assertEquals(body.success, true);

      // Verify it's gone
      const getRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'delete-oidc' }));
      const getBody = await jsonBody(getRes);
      assertEquals(getBody.oidcState, null);
})
    Deno.test('SessionDO - /oidc-state/delete - succeeds even if state does not exist', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance } = createDO();
      const res = await doInstance.fetch(postJSON('/oidc-state/delete', { state: 'nonexistent' }));
      const body = await jsonBody(res);
      assertEquals(body.success, true);
})  
  
    Deno.test('SessionDO - alarm - evicts expired sessions', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();

      // Create expired and valid sessions
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'expired-sess', expires_at: Date.now() - 1000 }),
      }));
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'valid-sess' }),
      }));

      state.storage.put;
      await doInstance.alarm();

      // Expired should be gone, valid should remain
      const expiredRes = await doInstance.fetch(postJSON('/session/get', { sessionId: 'expired-sess' }));
      assertEquals((await jsonBody(expiredRes)).session, null);

      const validRes = await doInstance.fetch(postJSON('/session/get', { sessionId: 'valid-sess' }));
      assertNotEquals((await jsonBody(validRes)).session, null);

      // Should have persisted the eviction
      assert(state.storage.put.calls.length > 0);
})
    Deno.test('SessionDO - alarm - evicts expired OIDC states', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();

      await doInstance.fetch(postJSON('/oidc-state/create', {
        oidcState: validOIDCState({ state: 'expired-oidc', expires_at: Date.now() - 1000 }),
      }));
      await doInstance.fetch(postJSON('/oidc-state/create', {
        oidcState: validOIDCState({ state: 'valid-oidc' }),
      }));

      state.storage.put;
      await doInstance.alarm();

      const expiredRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'expired-oidc' }));
      assertEquals((await jsonBody(expiredRes)).oidcState, null);

      const validRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'valid-oidc' }));
      assertNotEquals((await jsonBody(validRes)).oidcState, null);
})
    Deno.test('SessionDO - alarm - does not persist when nothing is evicted', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();

      // Create a valid session
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'valid-only' }),
      }));

      state.storage.put;
      await doInstance.alarm();

      // No eviction, so persist should not be called from alarm
      assertSpyCalls(state.storage.put, 0);
})
    Deno.test('SessionDO - alarm - reschedules alarm based on earliest expiry', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();
      const soonExpiry = Date.now() + 5000;

      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'soon', expires_at: soonExpiry }),
      }));
      await doInstance.fetch(postJSON('/session/create', {
        session: validSession({ id: 'later', expires_at: Date.now() + 3600_000 }),
      }));

      // Clear alarm from create
      state.storage.getAlarm = (async () => null) as any;
      state.storage.setAlarm;

      await doInstance.alarm();

      // Alarm should be scheduled at or after the earliest expiry
      assert(state.storage.setAlarm.calls.length > 0);
      const alarmTime = state.storage.setAlarm.calls[0][0] as number;
      assert(alarmTime >= soonExpiry);
})
    Deno.test('SessionDO - alarm - does not reschedule alarm when no entries exist', async () => {
  /* TODO: restore mocks manually */ void 0;
  const { doInstance, state } = createDO();
      state.storage.setAlarm;

      await doInstance.alarm();

      // No entries, getAlarm returns null (default), so no alarm scheduling
      // because earliestExpiry is Infinity
      assertSpyCalls(state.storage.setAlarm, 0);
})  
  
    Deno.test('SessionDO - constructor hydration - restores sessions and OIDC states from storage', async () => {
  /* TODO: restore mocks manually */ void 0;
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
      assertNotEquals((await jsonBody(sessRes)).session, null);

      // Verify OIDC state is restored
      const oidcRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'oidc-1' }));
      assertNotEquals((await jsonBody(oidcRes)).oidcState, null);
})
    Deno.test('SessionDO - constructor hydration - handles missing stored data gracefully', async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
      // No data in storage
      const state = createMockState(storage);
      const doInstance = new SessionDO(state as unknown as DurableObjectState);

      const res = await doInstance.fetch(postJSON('/session/get', { sessionId: 'nonexistent' }));
      assertEquals((await jsonBody(res)).session, null);
})
    Deno.test('SessionDO - constructor hydration - handles partial stored data (missing oidcStates)', async () => {
  /* TODO: restore mocks manually */ void 0;
  const storage = createMockStorage();
      storage._store.set('data', {
        sessions: { 'sess-1': validSession({ id: 'sess-1' }) },
      });

      const state = createMockState(storage);
      const doInstance = new SessionDO(state as unknown as DurableObjectState);

      const sessRes = await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-1' }));
      assertNotEquals((await jsonBody(sessRes)).session, null);

      // OIDC states should be empty, not crash
      const oidcRes = await doInstance.fetch(postJSON('/oidc-state/get', { state: 'anything' }));
      assertEquals((await jsonBody(oidcRes)).oidcState, null);
})  
  
    Deno.test('SessionDO - multiple sessions lifecycle - manages multiple sessions independently', async () => {
  /* TODO: restore mocks manually */ void 0;
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
      assertNotEquals((await jsonBody(resA)).session, null);
      assertNotEquals((await jsonBody(resB)).session, null);

      // Delete one
      await doInstance.fetch(postJSON('/session/delete', { sessionId: 'sess-a' }));

      // A is gone, B remains
      const afterA = await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-a' }));
      const afterB = await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-b' }));
      assertEquals((await jsonBody(afterA)).session, null);
      assertNotEquals((await jsonBody(afterB)).session, null);
})  
  
    Deno.test('SessionDO - concurrency control - wraps all mutating operations in blockConcurrencyWhile', async () => {
  /* TODO: restore mocks manually */ void 0;
  const state = createMockState();
      const { doInstance } = createDO(state);

      // constructor = 1 call
      const initialCalls = state.blockConcurrencyWhile.calls.length;

      // Each operation should add one blockConcurrencyWhile call
      await doInstance.fetch(postJSON('/session/create', { session: validSession() }));
      await doInstance.fetch(postJSON('/session/get', { sessionId: 'sess-1' }));
      await doInstance.fetch(postJSON('/session/delete', { sessionId: 'sess-1' }));
      await doInstance.fetch(postJSON('/oidc-state/create', { oidcState: validOIDCState() }));
      await doInstance.fetch(postJSON('/oidc-state/get', { state: 'oidc-state-1' }));
      await doInstance.fetch(postJSON('/oidc-state/delete', { state: 'oidc-state-1' }));

      // 6 operations after constructor
      assertEquals(state.blockConcurrencyWhile.calls.length, initialCalls + 6);
})  