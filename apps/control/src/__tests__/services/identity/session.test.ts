// deno-lint-ignore-file no-import-prefix no-unversioned-import
import {
  clearSessionCookie,
  createOIDCState,
  createSession,
  deleteOIDCState,
  deleteSession,
  generateSessionId,
  getOIDCState,
  getSession,
  getSessionIdFromCookie,
  normalizeSessionId,
  SESSION_COOKIE_NAME,
  type SessionStoreBinding,
  setSessionCookie,
} from "../../../../../../packages/control/src/application/services/identity/session.ts";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

// ---------------------------------------------------------------------------
// Pure function tests (no mocks needed)
// ---------------------------------------------------------------------------

Deno.test("generateSessionId - produces a base64url-encoded string of sufficient length", () => {
  const id = generateSessionId();
  assertEquals(typeof id, "string");
  // 32 random bytes -> at least 43 base64url chars
  assert(id.length >= 43);
});

Deno.test("generateSessionId - produces unique values on successive calls", () => {
  const a = generateSessionId();
  const b = generateSessionId();
  assertNotEquals(a, b);
});

Deno.test("normalizeSessionId - returns null for null / undefined / empty string", () => {
  assertEquals(normalizeSessionId(null), null);
  assertEquals(normalizeSessionId(undefined), null);
  assertEquals(normalizeSessionId(""), null);
  assertEquals(normalizeSessionId("   "), null);
});

Deno.test("normalizeSessionId - returns null for strings shorter than minimum length (16)", () => {
  assertEquals(normalizeSessionId("short"), null);
  assertEquals(normalizeSessionId("a".repeat(15)), null);
});

Deno.test("normalizeSessionId - returns null for strings exceeding maximum length (128)", () => {
  assertEquals(normalizeSessionId("a".repeat(129)), null);
});

Deno.test("normalizeSessionId - returns null for strings with invalid characters", () => {
  assertEquals(normalizeSessionId("a".repeat(16) + "!@#$"), null);
  assertEquals(normalizeSessionId("a".repeat(16) + " spaces"), null);
});

Deno.test("normalizeSessionId - accepts valid base64url-like session IDs", () => {
  const valid = "ABCDEFGHabcdefgh0123456789_-";
  assertEquals(normalizeSessionId(valid), valid);
});

Deno.test("normalizeSessionId - trims whitespace before validation", () => {
  const id = "A".repeat(32);
  assertEquals(normalizeSessionId(`  ${id}  `), id);
});

Deno.test("normalizeSessionId - accepts exactly 16-character and 128-character IDs", () => {
  assertEquals(normalizeSessionId("a".repeat(16)), "a".repeat(16));
  assertEquals(normalizeSessionId("a".repeat(128)), "a".repeat(128));
});

Deno.test("SESSION_COOKIE_NAME - uses the __Host- prefix for cookie hardening", () => {
  assertEquals(SESSION_COOKIE_NAME, "__Host-tp_session");
});

Deno.test("setSessionCookie - generates a Secure, HttpOnly, SameSite=Strict cookie", () => {
  const cookie = setSessionCookie("sess-abc", 604800);
  assertStringIncludes(cookie, `${SESSION_COOKIE_NAME}=sess-abc`);
  assertStringIncludes(cookie, "Path=/");
  assertStringIncludes(cookie, "Secure");
  assertStringIncludes(cookie, "HttpOnly");
  assertStringIncludes(cookie, "SameSite=Strict");
  assertStringIncludes(cookie, "Max-Age=604800");
});

Deno.test("clearSessionCookie - clears the cookie by setting Max-Age=0", () => {
  const cookie = clearSessionCookie();
  assertStringIncludes(cookie, `${SESSION_COOKIE_NAME}=`);
  assertStringIncludes(cookie, "Max-Age=0");
  assertStringIncludes(cookie, "Secure");
  assertStringIncludes(cookie, "HttpOnly");
});

Deno.test("getSessionIdFromCookie - returns null for null/undefined/empty cookie header", () => {
  assertEquals(getSessionIdFromCookie(null), null);
  assertEquals(getSessionIdFromCookie(undefined), null);
  assertEquals(getSessionIdFromCookie(""), null);
});

Deno.test("getSessionIdFromCookie - extracts the session cookie when present", () => {
  const sid = "A".repeat(43);
  const header = `other=value; ${SESSION_COOKIE_NAME}=${sid}; another=x`;
  assertEquals(getSessionIdFromCookie(header), sid);
});

Deno.test("getSessionIdFromCookie - returns null when session cookie is missing", () => {
  const header = "other_cookie=value; foo=bar";
  assertEquals(getSessionIdFromCookie(header), null);
});

Deno.test("getSessionIdFromCookie - returns null when session value fails normalization", () => {
  // value too short for normalizeSessionId
  const header = `${SESSION_COOKIE_NAME}=short`;
  assertEquals(getSessionIdFromCookie(header), null);
});

Deno.test("getSessionIdFromCookie - skips malformed cookie entries without =", () => {
  const sid = "A".repeat(43);
  const header = `badcookie; ${SESSION_COOKIE_NAME}=${sid}`;
  assertEquals(getSessionIdFromCookie(header), sid);
});
// ---------------------------------------------------------------------------
// Durable Object interaction tests (mock fetch)
// ---------------------------------------------------------------------------

type FetchCall = {
  input: string | Request;
  init?: RequestInit;
};

function createMockSessionStore(
  responder: (
    input: string | Request,
    init?: RequestInit,
  ) => Response | Promise<Response>,
): { sessionStore: SessionStoreBinding; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const stub = {
    fetch: async (input: string | Request, init?: RequestInit) => {
      calls.push({ input, init });
      return await Promise.resolve(responder(input, init));
    },
  };
  const sessionStore = {
    idFromName: () => ({ toString: () => "mock-id" }),
    get: () => stub,
  } as SessionStoreBinding;
  return { sessionStore, calls };
}

Deno.test("createSession - sends a POST to session/create and returns a valid session", async () => {
  const { sessionStore, calls } = createMockSessionStore(() =>
    new Response(null, { status: 200 })
  );

  const session = await createSession(sessionStore, "user-1");

  assertEquals(session.user_id, "user-1");
  assert(session.id.length >= 43);
  assert(session.expires_at > Date.now());
  assert(session.created_at <= Date.now());
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.input, "http://internal/session/create");
  assertEquals(calls[0]?.init?.method, "POST");
});

Deno.test("createSession - throws when the DO returns a non-OK response", async () => {
  const { sessionStore } = createMockSessionStore(() =>
    new Response(null, { status: 500 })
  );

  await assertRejects(
    () => createSession(sessionStore, "user-1"),
    Error,
    "Session service unavailable",
  );
});

Deno.test("createSession - throws when the DO fetch fails", async () => {
  const { sessionStore } = createMockSessionStore(() => {
    throw new Error("network error");
  });

  await assertRejects(
    () => createSession(sessionStore, "user-1"),
    Error,
    "Session service unavailable",
  );
});

Deno.test("getSession - returns the session when the DO returns a valid payload", async () => {
  const validSession = {
    id: "A".repeat(43),
    user_id: "user-1",
    expires_at: Date.now() + 3600_000,
    created_at: Date.now() - 1000,
  };
  const { sessionStore, calls } = createMockSessionStore(() =>
    new Response(JSON.stringify({ session: validSession }), { status: 200 })
  );

  const result = await getSession(sessionStore, "A".repeat(43));
  assertEquals(result, validSession);
  assertEquals(calls[0]?.input, "http://internal/session/get");
});

Deno.test("getSession - returns null for an invalid session ID", async () => {
  const { sessionStore, calls } = createMockSessionStore(() =>
    new Response(null, { status: 200 })
  );

  const result = await getSession(sessionStore, "bad");
  assertEquals(result, null);
  assertEquals(calls.length, 0);
});

Deno.test("getSession - returns null when the DO returns no session", async () => {
  const { sessionStore } = createMockSessionStore(() =>
    new Response(JSON.stringify({ session: null }), { status: 200 })
  );

  const result = await getSession(sessionStore, "A".repeat(43));
  assertEquals(result, null);
});

Deno.test("getSession - returns null for a malformed session payload", async () => {
  const { sessionStore } = createMockSessionStore(() =>
    new Response(JSON.stringify({ session: { id: "bad" } }), { status: 200 })
  );

  const result = await getSession(sessionStore, "A".repeat(43));
  assertEquals(result, null);
});

Deno.test("getSession - returns null when the DO returns a non-OK status", async () => {
  const { sessionStore } = createMockSessionStore(() =>
    new Response(null, { status: 500 })
  );

  const result = await getSession(sessionStore, "A".repeat(43));
  assertEquals(result, null);
});

Deno.test("getSession - returns null when the DO fetch throws", async () => {
  const { sessionStore } = createMockSessionStore(() => {
    throw new Error("network");
  });

  const result = await getSession(sessionStore, "A".repeat(43));
  assertEquals(result, null);
});

Deno.test("deleteSession - sends a POST to session/delete", async () => {
  const { sessionStore, calls } = createMockSessionStore(() =>
    new Response(null, { status: 200 })
  );

  await deleteSession(sessionStore, "A".repeat(43));
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.input, "http://internal/session/delete");
});

Deno.test("deleteSession - does nothing for an invalid session ID", async () => {
  const { sessionStore, calls } = createMockSessionStore(() =>
    new Response(null, { status: 200 })
  );

  await deleteSession(sessionStore, "bad");
  assertEquals(calls.length, 0);
});

Deno.test("deleteSession - does not throw on DO error", async () => {
  const { sessionStore } = createMockSessionStore(() => {
    throw new Error("network");
  });

  await deleteSession(sessionStore, "A".repeat(43));
});

Deno.test("createOIDCState - sends a POST to oidc-state/create", async () => {
  const { sessionStore, calls } = createMockSessionStore(() =>
    new Response(null, { status: 200 })
  );

  const oidcState = {
    state: "test-state",
    nonce: "test-nonce",
    code_verifier: "test-verifier",
    return_to: "/",
    expires_at: Date.now() + 600_000,
  };

  await createOIDCState(sessionStore, oidcState);
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.input, "http://internal/oidc-state/create");
  assertEquals(calls[0]?.init?.method, "POST");
});

Deno.test("createOIDCState - throws when DO returns non-OK status", async () => {
  const { sessionStore } = createMockSessionStore(() =>
    new Response(null, { status: 500 })
  );

  await assertRejects(
    () =>
      createOIDCState(sessionStore, {
        state: "s",
        nonce: "n",
        code_verifier: "v",
        return_to: "/",
        expires_at: Date.now(),
      }),
    Error,
    "Session service unavailable",
  );
});

Deno.test("getOIDCState - returns OIDC state from the DO", async () => {
  const state = {
    state: "test-state",
    nonce: "n",
    code_verifier: "v",
    return_to: "/",
    expires_at: Date.now() + 600_000,
  };
  const { sessionStore } = createMockSessionStore(() =>
    new Response(JSON.stringify({ oidcState: state }), { status: 200 })
  );

  const result = await getOIDCState(sessionStore, "test-state");
  assertEquals(result, state);
});

Deno.test("getOIDCState - returns null on error", async () => {
  const { sessionStore } = createMockSessionStore(() => {
    throw new Error("network");
  });

  const result = await getOIDCState(sessionStore, "test-state");
  assertEquals(result, null);
});

Deno.test("deleteOIDCState - sends a POST to oidc-state/delete", async () => {
  const { sessionStore, calls } = createMockSessionStore(() =>
    new Response(null, { status: 200 })
  );

  await deleteOIDCState(sessionStore, "test-state");
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.input, "http://internal/oidc-state/delete");
});

Deno.test("deleteOIDCState - does not throw on error", async () => {
  const { sessionStore } = createMockSessionStore(() => {
    throw new Error("network");
  });

  await deleteOIDCState(sessionStore, "test-state");
});
