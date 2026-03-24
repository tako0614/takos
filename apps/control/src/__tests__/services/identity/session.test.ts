import { describe, expect, it, vi, beforeEach } from 'vitest';

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

describe('generateSessionId', () => {
  it('produces a base64url-encoded string of sufficient length', () => {
    const id = generateSessionId();
    expect(typeof id).toBe('string');
    // 32 random bytes -> at least 43 base64url chars
    expect(id.length).toBeGreaterThanOrEqual(43);
  });

  it('produces unique values on successive calls', () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toBe(b);
  });
});

describe('normalizeSessionId', () => {
  it('returns null for null / undefined / empty string', () => {
    expect(normalizeSessionId(null)).toBeNull();
    expect(normalizeSessionId(undefined)).toBeNull();
    expect(normalizeSessionId('')).toBeNull();
    expect(normalizeSessionId('   ')).toBeNull();
  });

  it('returns null for strings shorter than minimum length (16)', () => {
    expect(normalizeSessionId('short')).toBeNull();
    expect(normalizeSessionId('a'.repeat(15))).toBeNull();
  });

  it('returns null for strings exceeding maximum length (128)', () => {
    expect(normalizeSessionId('a'.repeat(129))).toBeNull();
  });

  it('returns null for strings with invalid characters', () => {
    expect(normalizeSessionId('a'.repeat(16) + '!@#$')).toBeNull();
    expect(normalizeSessionId('a'.repeat(16) + ' spaces')).toBeNull();
  });

  it('accepts valid base64url-like session IDs', () => {
    const valid = 'ABCDEFGHabcdefgh0123456789_-';
    expect(normalizeSessionId(valid)).toBe(valid);
  });

  it('trims whitespace before validation', () => {
    const id = 'A'.repeat(32);
    expect(normalizeSessionId(`  ${id}  `)).toBe(id);
  });

  it('accepts exactly 16-character and 128-character IDs', () => {
    expect(normalizeSessionId('a'.repeat(16))).toBe('a'.repeat(16));
    expect(normalizeSessionId('a'.repeat(128))).toBe('a'.repeat(128));
  });
});

describe('SESSION_COOKIE_NAME', () => {
  it('uses the __Host- prefix for cookie hardening', () => {
    expect(SESSION_COOKIE_NAME).toBe('__Host-tp_session');
  });
});

describe('setSessionCookie', () => {
  it('generates a Secure, HttpOnly, SameSite=Strict cookie', () => {
    const cookie = setSessionCookie('sess-abc', 604800);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=sess-abc`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=604800');
  });
});

describe('clearSessionCookie', () => {
  it('clears the cookie by setting Max-Age=0', () => {
    const cookie = clearSessionCookie();
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });
});

describe('getSessionIdFromCookie', () => {
  it('returns null for null/undefined/empty cookie header', () => {
    expect(getSessionIdFromCookie(null)).toBeNull();
    expect(getSessionIdFromCookie(undefined)).toBeNull();
    expect(getSessionIdFromCookie('')).toBeNull();
  });

  it('extracts the session cookie when present', () => {
    const sid = 'A'.repeat(43);
    const header = `other=value; ${SESSION_COOKIE_NAME}=${sid}; another=x`;
    expect(getSessionIdFromCookie(header)).toBe(sid);
  });

  it('returns null when session cookie is missing', () => {
    const header = 'other_cookie=value; foo=bar';
    expect(getSessionIdFromCookie(header)).toBeNull();
  });

  it('returns null when session value fails normalization', () => {
    // value too short for normalizeSessionId
    const header = `${SESSION_COOKIE_NAME}=short`;
    expect(getSessionIdFromCookie(header)).toBeNull();
  });

  it('skips malformed cookie entries without =', () => {
    const sid = 'A'.repeat(43);
    const header = `badcookie; ${SESSION_COOKIE_NAME}=${sid}`;
    expect(getSessionIdFromCookie(header)).toBe(sid);
  });
});

// ---------------------------------------------------------------------------
// Durable Object interaction tests (mock fetch)
// ---------------------------------------------------------------------------

function createMockSessionStore() {
  const fetchMock = vi.fn<(input: string | Request, init?: RequestInit) => Promise<Response>>();
  const stubMock = { fetch: fetchMock };
  const idMock = { toString: () => 'mock-id' };

  const sessionStore = {
    idFromName: vi.fn(() => idMock),
    get: vi.fn(() => stubMock),
  };

  return { sessionStore, fetchMock };
}

describe('createSession', () => {
  it('sends a POST to session/create and returns a valid session', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const session = await createSession(sessionStore as never, 'user-1');

    expect(session.user_id).toBe('user-1');
    expect(session.id).toBeTruthy();
    expect(session.expires_at).toBeGreaterThan(Date.now());
    expect(session.created_at).toBeLessThanOrEqual(Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://internal/session/create');
    expect(init?.method).toBe('POST');
  });

  it('throws when the DO returns a non-OK response', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(createSession(sessionStore as never, 'user-1')).rejects.toThrow('Session service unavailable');
  });

  it('throws when the DO fetch fails', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockRejectedValue(new Error('network error'));

    await expect(createSession(sessionStore as never, 'user-1')).rejects.toThrow('Session service unavailable');
  });
});

describe('getSession', () => {
  it('returns the session when the DO returns a valid payload', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    const validSession = {
      id: 'A'.repeat(43),
      user_id: 'user-1',
      expires_at: Date.now() + 3600_000,
      created_at: Date.now() - 1000,
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ session: validSession }), { status: 200 }),
    );

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    expect(result).toEqual(validSession);
  });

  it('returns null for an invalid session ID', async () => {
    const { sessionStore } = createMockSessionStore();
    const result = await getSession(sessionStore as never, 'bad');
    expect(result).toBeNull();
  });

  it('returns null when the DO returns no session', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ session: null }), { status: 200 }),
    );

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    expect(result).toBeNull();
  });

  it('returns null for a malformed session payload', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ session: { id: 'bad' } }), { status: 200 }),
    );

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    expect(result).toBeNull();
  });

  it('returns null when the DO returns a non-OK status', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    expect(result).toBeNull();
  });

  it('returns null when the DO fetch throws', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockRejectedValue(new Error('network'));

    const result = await getSession(sessionStore as never, 'A'.repeat(43));
    expect(result).toBeNull();
  });
});

describe('deleteSession', () => {
  it('sends a POST to session/delete', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await deleteSession(sessionStore as never, 'A'.repeat(43));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://internal/session/delete');
  });

  it('does nothing for an invalid session ID', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    await deleteSession(sessionStore as never, 'bad');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw on DO error', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockRejectedValue(new Error('network'));
    await expect(deleteSession(sessionStore as never, 'A'.repeat(43))).resolves.toBeUndefined();
  });
});

describe('createOIDCState', () => {
  it('sends a POST to oidc-state/create', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const oidcState = {
      state: 'test-state',
      nonce: 'test-nonce',
      code_verifier: 'test-verifier',
      return_to: '/',
      expires_at: Date.now() + 600_000,
    };

    await createOIDCState(sessionStore as never, oidcState);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://internal/oidc-state/create');
    expect(init?.method).toBe('POST');
  });

  it('throws when DO returns non-OK status', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(
      createOIDCState(sessionStore as never, {
        state: 's',
        nonce: 'n',
        code_verifier: 'v',
        return_to: '/',
        expires_at: Date.now(),
      }),
    ).rejects.toThrow('Session service unavailable');
  });
});

describe('getOIDCState', () => {
  it('returns OIDC state from the DO', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    const state = {
      state: 'test-state',
      nonce: 'n',
      code_verifier: 'v',
      return_to: '/',
      expires_at: Date.now() + 600_000,
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ oidcState: state }), { status: 200 }),
    );

    const result = await getOIDCState(sessionStore as never, 'test-state');
    expect(result).toEqual(state);
  });

  it('returns null on error', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockRejectedValue(new Error('network'));

    const result = await getOIDCState(sessionStore as never, 'test-state');
    expect(result).toBeNull();
  });
});

describe('deleteOIDCState', () => {
  it('sends a POST to oidc-state/delete', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await deleteOIDCState(sessionStore as never, 'test-state');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://internal/oidc-state/delete');
  });

  it('does not throw on error', async () => {
    const { sessionStore, fetchMock } = createMockSessionStore();
    fetchMock.mockRejectedValue(new Error('network'));
    await expect(deleteOIDCState(sessionStore as never, 'test-state')).resolves.toBeUndefined();
  });
});
