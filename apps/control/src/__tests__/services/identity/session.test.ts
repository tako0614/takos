import {
  generateSessionId,
  normalizeSessionId,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  clearSessionCookie,
  getSessionIdFromCookie,
  createSession,
  getSession,
  deleteSession,
  createOIDCState,
  getOIDCState,
  deleteOIDCState,
} from '@/services/identity/session';

// ---------------------------------------------------------------------------
// Pure function tests (no mocks needed)
// ---------------------------------------------------------------------------


import { assertEquals, assertNotEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

  Deno.test('generateSessionId - produces a base64url-encoded string of sufficient length', () => {
  const id = generateSessionId();
    assertEquals(typeof id, 'string');
    // 32 random bytes -> at least 43 base64url chars
    assert(id.length >= 43);
})
  Deno.test('generateSessionId - produces unique values on successive calls', () => {
  const a = generateSessionId();
    const b = generateSessionId();
    assertNotEquals(a, b);
})

  Deno.test('normalizeSessionId - returns null for null / undefined / empty string', () => {
  assertEquals(normalizeSessionId(null), null);
    assertEquals(normalizeSessionId(undefined), null);
    assertEquals(normalizeSessionId(''), null);
    assertEquals(normalizeSessionId('   '), null);
})
  Deno.test('normalizeSessionId - returns null for strings shorter than minimum length (16)', () => {
  assertEquals(normalizeSessionId('short'), null);
    assertEquals(normalizeSessionId('a'.repeat(15)), null);
})
  Deno.test('normalizeSessionId - returns null for strings exceeding maximum length (128)', () => {
  assertEquals(normalizeSessionId('a'.repeat(129)), null);
})
  Deno.test('normalizeSessionId - returns null for strings with invalid characters', () => {
  assertEquals(normalizeSessionId('a'.repeat(16) + '!@#$'), null);
    assertEquals(normalizeSessionId('a'.repeat(16) + ' spaces'), null);
})
  Deno.test('normalizeSessionId - accepts valid base64url-like session IDs', () => {
  const valid = 'ABCDEFGHabcdefgh0123456789_-';
    assertEquals(normalizeSessionId(valid), valid);
})
  Deno.test('normalizeSessionId - trims whitespace before validation', () => {
  const id = 'A'.repeat(32);
    assertEquals(normalizeSessionId(`  ${id}  `), id);
})
  Deno.test('normalizeSessionId - accepts exactly 16-character and 128-character IDs', () => {
  assertEquals(normalizeSessionId('a'.repeat(16)), 'a'.repeat(16));
    assertEquals(normalizeSessionId('a'.repeat(128)), 'a'.repeat(128));
})

  Deno.test('SESSION_COOKIE_NAME - uses the __Host- prefix for cookie hardening', () => {
  assertEquals(SESSION_COOKIE_NAME, '__Host-tp_session');
})

  Deno.test('setSessionCookie - generates a Secure, HttpOnly, SameSite=Strict cookie', () => {
  const cookie = setSessionCookie('sess-abc', 604800);
    assertStringIncludes(cookie, `${SESSION_COOKIE_NAME}=sess-abc`);
    assertStringIncludes(cookie, 'Path=/');
    assertStringIncludes(cookie, 'Secure');
    assertStringIncludes(cookie, 'HttpOnly');
    assertStringIncludes(cookie, 'SameSite=Strict');
    assertStringIncludes(cookie, 'Max-Age=604800');
})

  Deno.test('clearSessionCookie - clears the cookie by setting Max-Age=0', () => {
  const cookie = clearSessionCookie();
    assertStringIncludes(cookie, `${SESSION_COOKIE_NAME}=`);
    assertStringIncludes(cookie, 'Max-Age=0');
    assertStringIncludes(cookie, 'Secure');
    assertStringIncludes(cookie, 'HttpOnly');
})

  Deno.test('getSessionIdFromCookie - returns null for null/undefined/empty cookie header', () => {
  assertEquals(getSessionIdFromCookie(null), null);
    assertEquals(getSessionIdFromCookie(undefined), null);
    assertEquals(getSessionIdFromCookie(''), null);
})
  Deno.test('getSessionIdFromCookie - extracts the session cookie when present', () => {
  const sid = 'A'.repeat(43);
    const header = `other=value; ${SESSION_COOKIE_NAME}=${sid}; another=x`;
    assertEquals(getSessionIdFromCookie(header), sid);
})
  Deno.test('getSessionIdFromCookie - returns null when session cookie is missing', () => {
  const header = 'other_cookie=value; foo=bar';
    assertEquals(getSessionIdFromCookie(header), null);
})
  Deno.test('getSessionIdFromCookie - returns null when session value fails normalization', () => {
  // value too short for normalizeSessionId
    const header = `${SESSION_COOKIE_NAME}=short`;
    assertEquals(getSessionIdFromCookie(header), null);
})
  Deno.test('getSessionIdFromCookie - skips malformed cookie entries without =', () => {
  const sid = 'A'.repeat(43);
    const header = `badcookie; ${SESSION_COOKIE_NAME}=${sid}`;
    assertEquals(getSessionIdFromCookie(header), sid);
})
// ---------------------------------------------------------------------------
// Durable Object interaction tests (mock fetch)
// ---------------------------------------------------------------------------

function createMockSessionStore() {
  const fetchMock = vi.fn<(input: string | Request, init?: RequestInit) => Promise<Response>>();
  const stubMock = { fetch: fetchMock };
  const idMock = { toString: () => 'mock-id' };

  const sessionStore = {
    idFromName: () => idMock,
    get: () => stubMock,
  };

  return { sessionStore, fetchMock };
}


  Deno.test('createSession - sends a POST to session/create and returns a valid session', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => new Response(null, { status: 200 })) as any;

    const session = await createSession(sessionStore as never, 'user-1');

    assertEquals(session.user_id, 'user-1');
    assert(session.id);
    assert(session.expires_at > Date.now());
    assert(session.created_at <= Date.now());
    assertSpyCalls(fetchMock, 1);
    const [url, init] = fetchMock.calls[0]!;
    assertEquals(url, 'http://internal/session/create');
    assertEquals(init?.method, 'POST');
})
  Deno.test('createSession - throws when the DO returns a non-OK response', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => new Response(null, { status: 500 })) as any;

    await await assertRejects(async () => { await createSession(sessionStore as never, 'user-1'); }, 'Session service unavailable');
})
  Deno.test('createSession - throws when the DO fetch fails', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => { throw new Error('network error'); }) as any;

    await await assertRejects(async () => { await createSession(sessionStore as never, 'user-1'); }, 'Session service unavailable');
})

  Deno.test('getSession - returns the session when the DO returns a valid payload', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    const validSession = {
      id: 'A'.repeat(43),
      user_id: 'user-1',
      expires_at: Date.now() + 3600_000,
      created_at: Date.now() - 1000,
    };
    fetchMock = (async () => new Response(JSON.stringify({ session: validSession }), { status: 200 }),) as any;

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    assertEquals(result, validSession);
})
  Deno.test('getSession - returns null for an invalid session ID', async () => {
  const { sessionStore } = createMockSessionStore();
    const result = await getSession(sessionStore as never, 'bad');
    assertEquals(result, null);
})
  Deno.test('getSession - returns null when the DO returns no session', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => new Response(JSON.stringify({ session: null }), { status: 200 }),) as any;

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    assertEquals(result, null);
})
  Deno.test('getSession - returns null for a malformed session payload', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => new Response(JSON.stringify({ session: { id: 'bad' } }), { status: 200 }),) as any;

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    assertEquals(result, null);
})
  Deno.test('getSession - returns null when the DO returns a non-OK status', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => new Response(null, { status: 500 })) as any;

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    assertEquals(result, null);
})
  Deno.test('getSession - returns null when the DO fetch throws', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => { throw new Error('network'); }) as any;

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    assertEquals(result, null);
})

  Deno.test('deleteSession - sends a POST to session/delete', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => new Response(null, { status: 200 })) as any;

    await deleteSession(sessionStore as never, 'A'.repeat(43));
    assertSpyCalls(fetchMock, 1);
    const [url] = fetchMock.calls[0]!;
    assertEquals(url, 'http://internal/session/delete');
})
  Deno.test('deleteSession - does nothing for an invalid session ID', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    await deleteSession(sessionStore as never, 'bad');
    assertSpyCalls(fetchMock, 0);
})
  Deno.test('deleteSession - does not throw on DO error', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => { throw new Error('network'); }) as any;
    await assertEquals(await deleteSession(sessionStore as never, 'A'.repeat(43)), undefined);
})

  Deno.test('createOIDCState - sends a POST to oidc-state/create', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => new Response(null, { status: 200 })) as any;

    const oidcState = {
      state: 'test-state',
      nonce: 'test-nonce',
      code_verifier: 'test-verifier',
      return_to: '/',
      expires_at: Date.now() + 600_000,
    };

    await createOIDCState(sessionStore as never, oidcState);
    assertSpyCalls(fetchMock, 1);
    const [url, init] = fetchMock.calls[0]!;
    assertEquals(url, 'http://internal/oidc-state/create');
    assertEquals(init?.method, 'POST');
})
  Deno.test('createOIDCState - throws when DO returns non-OK status', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => new Response(null, { status: 500 })) as any;

    await await assertRejects(async () => { await 
      createOIDCState(sessionStore as never, {
        state: 's',
        nonce: 'n',
        code_verifier: 'v',
        return_to: '/',
        expires_at: Date.now(),
      }),
    ; }, 'Session service unavailable');
})

  Deno.test('getOIDCState - returns OIDC state from the DO', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    const state = {
      state: 'test-state',
      nonce: 'n',
      code_verifier: 'v',
      return_to: '/',
      expires_at: Date.now() + 600_000,
    };
    fetchMock = (async () => new Response(JSON.stringify({ oidcState: state }), { status: 200 }),) as any;

    const result = await getOIDCState(sessionStore as never, 'test-state');
    assertEquals(result, state);
})
  Deno.test('getOIDCState - returns null on error', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => { throw new Error('network'); }) as any;

    const result = await getOIDCState(sessionStore as never, 'test-state');
    assertEquals(result, null);
})

  Deno.test('deleteOIDCState - sends a POST to oidc-state/delete', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => new Response(null, { status: 200 })) as any;

    await deleteOIDCState(sessionStore as never, 'test-state');
    assertSpyCalls(fetchMock, 1);
    const [url] = fetchMock.calls[0]!;
    assertEquals(url, 'http://internal/oidc-state/delete');
})
  Deno.test('deleteOIDCState - does not throw on error', async () => {
  const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock = (async () => { throw new Error('network'); }) as any;
    await assertEquals(await deleteOIDCState(sessionStore as never, 'test-state'), undefined);
})