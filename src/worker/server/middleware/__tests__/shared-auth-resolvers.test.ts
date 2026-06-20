import { test } from "bun:test";
import type { Context } from "hono";
import { assertEquals } from "@takos/test/assert";

import type { Env, Session, User } from "../../../shared/types/index.ts";
import {
  type AccountsBearerResolverDeps,
  resolveAccountsBearer,
} from "../accounts-bearer.ts";
import {
  type CookieSessionResolverDeps,
  resolveCookieSession,
} from "../session-auth.ts";

const USER: User = {
  id: "user-1",
  email: "u1@example.com",
  name: "User One",
  username: "user1",
  bio: null,
  picture: null,
  trust_tier: "normal",
  setup_completed: true,
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
};

const SESSION: Session = {
  id: "session_abc",
  user_id: "user-1",
  expires_at: Date.now() + 3_600_000,
  created_at: Date.now(),
};

function ctxWithAuthHeader(value: string | undefined): Context<{
  Bindings: Env;
  Variables: object;
}> {
  return {
    req: {
      header: (name: string) => (name === "Authorization" ? value : undefined),
    },
  } as unknown as Context<{ Bindings: Env; Variables: object }>;
}

const fakeServices = { sql: { binding: {} } } as never;
const fakeConfig = {
  oidcIssuerUrl: "https://accounts.test",
} as never;

function bearerDeps(
  over: Partial<AccountsBearerResolverDeps>,
): AccountsBearerResolverDeps {
  return {
    getPlatformServices: () => fakeServices,
    getPlatformConfig: () => fakeConfig,
    isValidUserId: (id: unknown): id is string =>
      typeof id === "string" && id.length > 0,
    getCachedUser: async () => USER,
    resolveSelfIssuedBearer: async () => ({
      kind: "ok" as const,
      user: USER,
      userId: "user-1",
      subject: "sub",
      scopes: ["profile"],
    }),
    ...over,
  } as AccountsBearerResolverDeps;
}

// --- resolveAccountsBearer pipeline classification ---

test("resolveAccountsBearer: no Authorization header -> no-bearer", async () => {
  const r = await resolveAccountsBearer(
    ctxWithAuthHeader(undefined),
    bearerDeps({}),
  );
  assertEquals(r.kind, "no-bearer");
});

test("resolveAccountsBearer: unsupported app-local prefix -> unsupported-app-local-bearer", async () => {
  const r = await resolveAccountsBearer(
    ctxWithAuthHeader("Bearer tak_pat_abc"),
    bearerDeps({}),
  );
  assertEquals(r.kind, "unsupported-app-local-bearer");
});

test("resolveAccountsBearer: opaque non-candidate bearer -> not-accounts", async () => {
  const r = await resolveAccountsBearer(
    ctxWithAuthHeader("Bearer plain-opaque-token"),
    bearerDeps({}),
  );
  assertEquals(r.kind, "not-accounts");
});

test("resolveAccountsBearer: accounts candidate without SQL binding -> no-db", async () => {
  const r = await resolveAccountsBearer(
    ctxWithAuthHeader("Bearer takpat_x"),
    bearerDeps({ getPlatformServices: () => ({ sql: undefined }) as never }),
  );
  assertEquals(r.kind, "no-db");
});

test("resolveAccountsBearer: self-issued verification rejects -> invalid", async () => {
  const r = await resolveAccountsBearer(
    ctxWithAuthHeader("Bearer takpat_x"),
    bearerDeps({ resolveSelfIssuedBearer: async () => ({ kind: "invalid" }) }),
  );
  assertEquals(r.kind, "invalid");
});

test("resolveAccountsBearer: missing required scope -> scope-insufficient", async () => {
  const r = await resolveAccountsBearer(
    ctxWithAuthHeader("Bearer takpat_x"),
    bearerDeps({}),
    { requiredScopes: ["threads:read"] },
  );
  assertEquals(r.kind, "scope-insufficient");
});

test("resolveAccountsBearer: valid token, no cached user -> user-not-found", async () => {
  const r = await resolveAccountsBearer(
    ctxWithAuthHeader("Bearer takpat_x"),
    bearerDeps({ getCachedUser: async () => null }),
  );
  assertEquals(r.kind, "user-not-found");
});

test("resolveAccountsBearer: valid token + scope + user -> ok", async () => {
  const r = await resolveAccountsBearer(
    ctxWithAuthHeader("Bearer takpat_x"),
    bearerDeps({}),
    { requiredScopes: ["profile"] },
  );
  assertEquals(r.kind, "ok");
  if (r.kind === "ok") assertEquals(r.user.id, "user-1");
});

// --- resolveCookieSession revocation invariant (Phase 18.2 H11) ---

function sessionDeps(
  over: Partial<CookieSessionResolverDeps>,
): CookieSessionResolverDeps {
  return {
    isSessionRevoked: async () => false,
    getSession: async () => SESSION,
    getCachedUser: async () => USER,
    isValidUserId: (id: unknown): id is string =>
      typeof id === "string" && id.length > 0,
    ...over,
  } as CookieSessionResolverDeps;
}

const sessionCtx = {} as unknown as Context<{
  Bindings: Env;
  Variables: object;
}>;

test("resolveCookieSession: revoked session id -> revoked (invariant single-sourced)", async () => {
  let getSessionCalled = false;
  const r = await resolveCookieSession(
    sessionCtx,
    sessionDeps({
      isSessionRevoked: async () => true,
      getSession: async () => {
        getSessionCalled = true;
        return SESSION;
      },
    }),
    { sessionId: "session_abc", sessionStore: {}, dbBinding: {} as never },
  );
  assertEquals(r.kind, "revoked");
  // Fail-closed: revoked sessions never reach the session store.
  assertEquals(getSessionCalled, false);
});

test("resolveCookieSession: no dbBinding skips the revocation check", async () => {
  let revokedChecked = false;
  const r = await resolveCookieSession(
    sessionCtx,
    sessionDeps({
      isSessionRevoked: async () => {
        revokedChecked = true;
        return true;
      },
    }),
    { sessionId: "session_abc", sessionStore: {}, dbBinding: undefined },
  );
  assertEquals(revokedChecked, false);
  assertEquals(r.kind, "ok");
});

test("resolveCookieSession: missing session record -> no-session", async () => {
  const r = await resolveCookieSession(
    sessionCtx,
    sessionDeps({ getSession: async () => null }),
    { sessionId: "session_abc", sessionStore: {}, dbBinding: {} as never },
  );
  assertEquals(r.kind, "no-session");
});

test("resolveCookieSession: session ok but no cached user -> user-not-found", async () => {
  const r = await resolveCookieSession(
    sessionCtx,
    sessionDeps({ getCachedUser: async () => null }),
    { sessionId: "session_abc", sessionStore: {}, dbBinding: {} as never },
  );
  assertEquals(r.kind, "user-not-found");
});

test("resolveCookieSession: active session + user -> ok", async () => {
  const r = await resolveCookieSession(sessionCtx, sessionDeps({}), {
    sessionId: "session_abc",
    sessionStore: {},
    dbBinding: {} as never,
  });
  assertEquals(r.kind, "ok");
  if (r.kind === "ok") assertEquals(r.user.id, "user-1");
});
