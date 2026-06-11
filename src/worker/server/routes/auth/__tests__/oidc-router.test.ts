import { test } from "bun:test";
import { RUN_INTEGRATION_TESTS } from "@takos/test/integration";
import { Hono } from "hono";
import * as jose from "jose";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { assertEquals, assertExists, assertStringIncludes } from "@takos/test/assert";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createEphemeralAccountsHandler } from "../../../../../../../takosumi/accounts/service/src/mod.ts";
import * as schema from "../../../../infra/db/schema.ts";
import { accounts, authIdentities } from "../../../../infra/db/schema.ts";
import { generateCodeChallenge } from "../../../../application/services/identity/oidc-pkce.ts";
import type { Env, User } from "../../../../shared/types/index.ts";
import { authOidcRouter } from "../oidc.ts";

type StoredOidcState = {
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  expires_at: number;
};

type CreatedSession = {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
  last_rotated_at?: number;
};

function createSessionStore(
  states: StoredOidcState[],
  createdSessions: CreatedSession[] = [],
) {
  return {
    idFromName: (name: string) => name,
    get: (_id: string) => ({
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const body = await request.json() as {
          oidcState?: StoredOidcState;
          state?: string;
          session?: CreatedSession;
        };
        const path = new URL(request.url).pathname;
        if (path === "/oidc-state/create" && body.oidcState) {
          states.push(body.oidcState);
          return Response.json({ success: true });
        }
        if (path === "/oidc-state/get") {
          return Response.json({
            oidcState: states.find((state) => state.state === body.state) ??
              null,
          });
        }
        if (path === "/oidc-state/delete") {
          const index = states.findIndex((state) => state.state === body.state);
          if (index >= 0) states.splice(index, 1);
          return Response.json({ success: true });
        }
        if (path === "/session/create" && body.session) {
          createdSessions.push(body.session);
          return Response.json({ success: true });
        }
        return Response.json({ success: true });
      },
    }),
  };
}

function createEnv(input: {
  states?: StoredOidcState[];
  oidcIssuerUrl?: string;
  oidcDiscoveryUrl?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcRedirectUri?: string;
  includeSessionStore?: boolean;
  sqlBinding?: unknown;
  createdSessions?: CreatedSession[];
} = {}): Env {
  const states = input.states ?? [];
  const sessionStore = input.includeSessionStore === false
    ? undefined
    : createSessionStore(states, input.createdSessions);
  return {
    PLATFORM: {
      config: {
        adminDomain: "takos.example.test",
        oidcIssuerUrl: input.oidcIssuerUrl,
        oidcDiscoveryUrl: input.oidcDiscoveryUrl,
        oidcClientId: input.oidcClientId,
        oidcClientSecret: input.oidcClientSecret,
        oidcRedirectUri: input.oidcRedirectUri,
      },
      services: {
        sql: input.sqlBinding ? { binding: input.sqlBinding } : undefined,
        notifications: { sessionStore },
      },
      bindings: {},
    },
  } as unknown as Env;
}

async function createAuthTestDb(dbPath: string) {
  const client = createClient({ url: pathToFileURL(dbPath).href });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT NOT NULL PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      picture TEXT,
      bio TEXT,
      email TEXT UNIQUE,
      trust_tier TEXT NOT NULL DEFAULT 'new',
      setup_completed INTEGER NOT NULL DEFAULT 0,
      default_repository_id TEXT,
      head_snapshot_id TEXT,
      ai_model TEXT DEFAULT 'gpt-5.5',
      model_backend TEXT DEFAULT 'openai',
      security_posture TEXT NOT NULL DEFAULT 'standard',
      owner_account_id TEXT,
      takosumi_installation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE auth_identities (
      id TEXT NOT NULL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_sub TEXT NOT NULL,
      email_snapshot TEXT,
      email_kind TEXT NOT NULL DEFAULT 'unknown',
      linked_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL,
      refresh_token_enc TEXT
    );
    CREATE UNIQUE INDEX idx_auth_identities_provider_sub
      ON auth_identities(provider, provider_sub);
    CREATE TABLE auth_sessions (
      id TEXT NOT NULL PRIMARY KEY,
      account_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      ip_address TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return {
    client,
    db: drizzle(client, { schema }),
  };
}

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: { user?: User } }>();
  app.route("/auth", authOidcRouter);
  return app;
}

function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "takos-oidc-"));
}

async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

test("OIDC login route rejects missing config", async () => {
  const response = await createApp().fetch(
    new Request("https://takos.example.test/auth/oidc/login"),
    createEnv({ includeSessionStore: false }),
  );

  assertEquals(response.status, 500);
  assertStringIncludes(
    await response.text(),
    "Takosumi Accounts OIDC is not configured.",
  );
});

test("OIDC callback rejects when the state cookie is missing or mismatched", async () => {
  const baseConfig = {
    oidcIssuerUrl: "https://accounts.example.test/",
    oidcDiscoveryUrl: "http://accounts.internal:8787",
    oidcClientId: "takos-client",
    oidcClientSecret: "client-secret",
    oidcRedirectUri: "https://takos.example.test/auth/oidc/callback",
  };

  // No state cookie at all: a callback this browser never initiated.
  const missingStates: StoredOidcState[] = [{
    state: "state-csrf",
    nonce: "nonce-csrf",
    code_verifier: "verifier-csrf",
    return_to: "/",
    expires_at: Date.now() + 60_000,
  }];
  const missingSessions: CreatedSession[] = [];
  const missingResponse = await createApp().fetch(
    new Request(
      "https://takos.example.test/auth/oidc/callback?code=auth-code&state=state-csrf",
    ),
    createEnv({
      states: missingStates,
      createdSessions: missingSessions,
      sqlBinding: {},
      ...baseConfig,
    }),
  );
  assertEquals(missingResponse.status, 400);
  assertStringIncludes(await missingResponse.text(), "Invalid OIDC state.");
  assertEquals(missingSessions.length, 0);
  // Server-side state must not be consumed by an unbound callback.
  assertEquals(missingStates.length, 1);

  // Cookie present but bound to a different flow than the returned state.
  const mismatchStates: StoredOidcState[] = [{
    state: "state-victim",
    nonce: "nonce-victim",
    code_verifier: "verifier-victim",
    return_to: "/",
    expires_at: Date.now() + 60_000,
  }];
  const mismatchSessions: CreatedSession[] = [];
  const mismatchResponse = await createApp().fetch(
    new Request(
      "https://takos.example.test/auth/oidc/callback?code=auth-code&state=state-victim",
      { headers: { Cookie: "__Host-tp_oidc_state=state-attacker" } },
    ),
    createEnv({
      states: mismatchStates,
      createdSessions: mismatchSessions,
      sqlBinding: {},
      ...baseConfig,
    }),
  );
  assertEquals(mismatchResponse.status, 400);
  assertStringIncludes(await mismatchResponse.text(), "Invalid OIDC state.");
  assertEquals(mismatchSessions.length, 0);
  assertEquals(mismatchStates.length, 1);
});

test("OIDC callback exchanges code, verifies id_token, provisions app-local user, and creates a session", async () => {
  const dir = await makeTempDir();
  const authDb = await createAuthTestDb(`${dir}/control.sqlite`);
  const states: StoredOidcState[] = [{
    state: "state-1",
    nonce: "nonce-1",
    code_verifier: "verifier-1",
    return_to: "/space-settings",
    expires_at: Date.now() + 60_000,
  }];
  const createdSessions: CreatedSession[] = [];
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk = await jose.exportJWK(publicKey);
  const jwk = { ...publicJwk, alg: "ES256", kid: "test-key" };
  const idToken = await new jose.SignJWT({
    sub: "takosumi-subject-1",
    nonce: "nonce-1",
    email: "takosumi-user@example.test",
    email_verified: true,
    name: "Takosumi User",
    picture: "https://accounts.example.test/avatar.png",
  })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer("https://accounts.example.test")
    .setAudience("takos-client")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const tokenRequests: URLSearchParams[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const request = new Request(
      input,
      init as globalThis.RequestInit | undefined,
    );
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: "https://accounts.example.test",
        authorization_endpoint: "https://accounts.example.test/oauth/authorize",
        token_endpoint: "https://accounts.example.test/oauth/token",
        jwks_uri: "https://accounts.example.test/oauth/jwks",
        userinfo_endpoint: "https://accounts.example.test/oauth/userinfo",
      });
    }
    if (request.url === "http://accounts.internal:8787/oauth/token") {
      tokenRequests.push(new URLSearchParams(await request.text()));
      return Response.json({
        access_token: "access-token-1",
        id_token: idToken,
        token_type: "Bearer",
      });
    }
    if (request.url === "http://accounts.internal:8787/oauth/jwks") {
      return Response.json({ keys: [jwk] });
    }
    if (request.url === "http://accounts.internal:8787/oauth/userinfo") {
      assertEquals(
        request.headers.get("authorization"),
        "Bearer access-token-1",
      );
      return Response.json({
        sub: "takosumi-subject-1",
        email: "takosumi-user@example.test",
        name: "Takosumi User",
        picture: "https://accounts.example.test/avatar.png",
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await createApp().fetch(
      new Request(
        "https://takos.example.test/auth/oidc/callback?code=auth-code-1&state=state-1",
        {
          headers: {
            "User-Agent": "deno-test",
            Cookie: "__Host-tp_oidc_state=state-1",
          },
        },
      ),
      createEnv({
        states,
        createdSessions,
        sqlBinding: authDb.db,
        oidcIssuerUrl: "https://accounts.example.test/",
        oidcDiscoveryUrl: "http://accounts.internal:8787",
        oidcClientId: "takos-client",
        oidcClientSecret: "client-secret",
        oidcRedirectUri: "https://takos.example.test/auth/oidc/callback",
      }),
    );

    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/setup");
    const setCookies = response.headers.getSetCookie();
    assertEquals(
      setCookies.some((cookie) => cookie.startsWith("__Host-tp_session=")),
      true,
    );
    // The single-use state cookie is cleared on the successful callback.
    assertEquals(
      setCookies.some((cookie) =>
        cookie.startsWith("__Host-tp_oidc_state=;") &&
        cookie.includes("Max-Age=0")
      ),
      true,
    );
    assertEquals(states.length, 0);
    assertEquals(createdSessions.length, 1);
    assertEquals(tokenRequests.length, 1);
    assertEquals(tokenRequests[0].get("grant_type"), "authorization_code");
    assertEquals(tokenRequests[0].get("code"), "auth-code-1");
    assertEquals(tokenRequests[0].get("client_id"), "takos-client");
    assertEquals(tokenRequests[0].get("client_secret"), "client-secret");
    assertEquals(tokenRequests[0].get("code_verifier"), "verifier-1");

    const account = await authDb.db.select({
      id: accounts.id,
      email: accounts.email,
      name: accounts.name,
      slug: accounts.slug,
      setupCompleted: accounts.setupCompleted,
    }).from(accounts).get();
    assertExists(account);
    assertEquals(account.email, "takosumi-user@example.test");
    assertEquals(account.name, "Takosumi User");
    assertEquals(account.setupCompleted, false);
    assertEquals(createdSessions[0].user_id, account.id);

    const identity = await authDb.db.select({
      userId: authIdentities.userId,
      provider: authIdentities.provider,
      providerSub: authIdentities.providerSub,
      emailSnapshot: authIdentities.emailSnapshot,
      emailKind: authIdentities.emailKind,
    }).from(authIdentities).get();
    assertExists(identity);
    assertEquals(identity.userId, account.id);
    assertEquals(identity.provider, "oidc");
    assertEquals(
      identity.providerSub,
      "https://accounts.example.test#takosumi-subject-1",
    );
    assertEquals(identity.emailSnapshot, "takosumi-user@example.test");
    assertEquals(identity.emailKind, "oidc_verified");
  } finally {
    globalThis.fetch = originalFetch;
    authDb.client.close();
    await removeTempDir(dir);
  }
});

// Env-coupled: starts a real Takosumi Accounts server and performs a live
// fetch against the issued authorize URL. Skipped in the default gate; run with
// TAKOS_INTEGRATION=1.
test.skipIf(!RUN_INTEGRATION_TESTS)(
  "OIDC login reaches real Takosumi Accounts while default managed offering gate stays closed",
  async () => {
    const accountsServer = await startAccountsServer({
      clientId: "takos-client",
      redirectUri: "https://takos.example.test/auth/oidc/callback",
      subject: "tsub_oidc_owner",
    });
    const dir = await makeTempDir();
    const authDb = await createAuthTestDb(`${dir}/real-accounts-oidc.sqlite`);
    const states: StoredOidcState[] = [];
    const createdSessions: CreatedSession[] = [];

    try {
      const env = createEnv({
        states,
        createdSessions,
        sqlBinding: authDb.db,
        oidcIssuerUrl: accountsServer.url,
        oidcClientId: "takos-client",
        oidcRedirectUri: "https://takos.example.test/auth/oidc/callback",
      });
      const app = createApp();

      const loginResponse = await app.fetch(
        new Request(
          "https://takos.example.test/auth/oidc/login?return_to=%2Fapps",
        ),
        env,
      );
      assertEquals(loginResponse.status, 302);
      assertEquals(states.length, 1);
      const authorizeUrl = loginResponse.headers.get("location");
      assertExists(authorizeUrl);

      const authorizeResponse = await fetch(authorizeUrl, {
        redirect: "manual",
      });
      assertEquals(authorizeResponse.status, 503);
      const authorizeBody = await authorizeResponse.json() as {
        error?: string;
      };
      assertEquals(authorizeBody.error, "launch_readiness_not_complete");
      assertEquals(states.length, 1);
      assertEquals(createdSessions.length, 0);
    } finally {
      authDb.client.close();
      await removeTempDir(dir);
      await accountsServer.stop();
    }
  },
  15_000,
);

test("regression: OIDC callback links an existing Takos account by verified email", async () => {
  const dir = await makeTempDir();
  const authDb = await createAuthTestDb(`${dir}/control.sqlite`);
  const timestamp = new Date().toISOString();
  await authDb.db.insert(accounts).values({
    id: "legacy-user-1",
    type: "user",
    status: "active",
    email: "legacy@example.test",
    name: "Legacy User",
    slug: "legacy-user",
    picture: null,
    setupCompleted: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const states: StoredOidcState[] = [{
    state: "state-legacy",
    nonce: "nonce-legacy",
    code_verifier: "verifier-legacy",
    return_to: "/spaces",
    expires_at: Date.now() + 60_000,
  }];
  const createdSessions: CreatedSession[] = [];
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk = await jose.exportJWK(publicKey);
  const jwk = { ...publicJwk, alg: "ES256", kid: "legacy-key" };
  const idToken = await new jose.SignJWT({
    sub: "takosumi-legacy-subject",
    nonce: "nonce-legacy",
    email: "legacy@example.test",
    email_verified: true,
    name: "Accounts Name",
  })
    .setProtectedHeader({ alg: "ES256", kid: "legacy-key" })
    .setIssuer("https://accounts.example.test")
    .setAudience("takos-client")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const request = new Request(
      input,
      init as globalThis.RequestInit | undefined,
    );
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: "https://accounts.example.test",
        authorization_endpoint: "https://accounts.example.test/oauth/authorize",
        token_endpoint: "https://accounts.example.test/oauth/token",
        jwks_uri: "https://accounts.example.test/oauth/jwks",
        userinfo_endpoint: "https://accounts.example.test/oauth/userinfo",
      });
    }
    if (request.url === "http://accounts.internal:8787/oauth/token") {
      return Response.json({
        access_token: "access-token-legacy",
        id_token: idToken,
        token_type: "Bearer",
      });
    }
    if (request.url === "http://accounts.internal:8787/oauth/jwks") {
      return Response.json({ keys: [jwk] });
    }
    if (request.url === "http://accounts.internal:8787/oauth/userinfo") {
      return Response.json({
        sub: "takosumi-legacy-subject",
        email: "legacy@example.test",
        email_verified: true,
        name: "Accounts Name",
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await createApp().fetch(
      new Request(
        "https://takos.example.test/auth/oidc/callback?code=auth-code-legacy&state=state-legacy",
        { headers: { Cookie: "__Host-tp_oidc_state=state-legacy" } },
      ),
      createEnv({
        states,
        createdSessions,
        sqlBinding: authDb.db,
        oidcIssuerUrl: "https://accounts.example.test/",
        oidcDiscoveryUrl: "http://accounts.internal:8787",
        oidcClientId: "takos-client",
        oidcClientSecret: "client-secret",
        oidcRedirectUri: "https://takos.example.test/auth/oidc/callback",
      }),
    );

    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/spaces");
    assertEquals(createdSessions.length, 1);
    assertEquals(createdSessions[0].user_id, "legacy-user-1");

    const accountRows = await authDb.db.select({
      id: accounts.id,
      name: accounts.name,
      setupCompleted: accounts.setupCompleted,
    }).from(accounts).all();
    assertEquals(accountRows.length, 1);
    assertEquals(accountRows[0], {
      id: "legacy-user-1",
      name: "Legacy User",
      setupCompleted: true,
    });

    const identity = await authDb.db.select({
      userId: authIdentities.userId,
      provider: authIdentities.provider,
      providerSub: authIdentities.providerSub,
      emailSnapshot: authIdentities.emailSnapshot,
      emailKind: authIdentities.emailKind,
    }).from(authIdentities).get();
    assertExists(identity);
    assertEquals(identity, {
      userId: "legacy-user-1",
      provider: "oidc",
      providerSub: "https://accounts.example.test#takosumi-legacy-subject",
      emailSnapshot: "legacy@example.test",
      emailKind: "oidc_verified",
    });
  } finally {
    globalThis.fetch = originalFetch;
    authDb.client.close();
    await removeTempDir(dir);
  }
});

type AccountsServer = {
  url: string;
  stop: () => Promise<void>;
};

async function startAccountsServer(input: {
  clientId: string;
  redirectUri: string;
  subject: string;
}): Promise<AccountsServer> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const handler = await createEphemeralAccountsHandler({
    issuer: url,
    subject: input.subject,
    clients: [{
      clientId: input.clientId,
      redirectUris: [input.redirectUri],
    }],
    managedOfferingAccess: { status: "closed" },
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: handler,
  });

  try {
    await waitForAccounts(url);
  } catch (error) {
    server.stop(true);
    throw new Error(
      `Takosumi Accounts did not start: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    url,
    stop: async () => {
      server.stop(true);
    },
  };
}

async function waitForAccounts(accountsUrl: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `${accountsUrl}/.well-known/openid-configuration`,
      );
      if (response.ok) {
        await response.body?.cancel();
        return;
      }
      lastError = `HTTP ${response.status}`;
      await response.body?.cancel();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(lastError);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

test("OIDC login route redirects to issuer authorization endpoint", async () => {
  const states: StoredOidcState[] = [];
  const discoveryRequests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input, init) => {
    const request = new Request(
      input,
      init as globalThis.RequestInit | undefined,
    );
    discoveryRequests.push(request);
    return Promise.resolve(Response.json({
      issuer: "https://accounts.example.test",
      authorization_endpoint: "https://accounts.example.test/oauth/authorize",
      token_endpoint: "https://accounts.example.test/oauth/token",
      jwks_uri: "https://accounts.example.test/oauth/jwks",
    }));
  }) as typeof fetch;

  try {
    const response = await createApp().fetch(
      new Request(
        "https://takos.example.test/auth/oidc/login?return_to=%2Fspace-settings",
      ),
      createEnv({
        states,
        oidcIssuerUrl: "https://accounts.example.test/",
        oidcDiscoveryUrl: "http://accounts.internal:8787",
        oidcClientId: "takos-client",
        oidcRedirectUri: "https://takos.example.test/auth/oidc/callback",
      }),
    );

    assertEquals(response.status, 302);
    assertEquals(
      discoveryRequests[0]?.url,
      "http://accounts.internal:8787/.well-known/openid-configuration",
    );
    assertEquals(
      discoveryRequests[0]?.headers.get("accept"),
      "application/json",
    );

    const location = response.headers.get("location");
    const redirect = new URL(location ?? "");
    assertEquals(
      `${redirect.origin}${redirect.pathname}`,
      "https://accounts.example.test/oauth/authorize",
    );

    // Login initiation binds the OAuth state to this browser via a short-lived
    // HttpOnly cookie whose value equals the `state` query param.
    const stateCookie = response.headers.getSetCookie().find((cookie) =>
      cookie.startsWith("__Host-tp_oidc_state=")
    );
    assertExists(stateCookie);
    assertStringIncludes(
      stateCookie,
      `__Host-tp_oidc_state=${redirect.searchParams.get("state")}`,
    );
    assertStringIncludes(stateCookie, "HttpOnly");
    assertStringIncludes(stateCookie, "Secure");
    assertStringIncludes(stateCookie, "SameSite=Lax");
    assertEquals(redirect.searchParams.get("response_type"), "code");
    assertEquals(redirect.searchParams.get("client_id"), "takos-client");
    assertEquals(
      redirect.searchParams.get("redirect_uri"),
      "https://takos.example.test/auth/oidc/callback",
    );
    assertEquals(redirect.searchParams.get("scope"), "openid email profile");
    assertEquals(redirect.searchParams.get("code_challenge_method"), "S256");

    const stored = states[0];
    assertEquals(stored.state, redirect.searchParams.get("state"));
    assertEquals(stored.nonce, redirect.searchParams.get("nonce"));
    assertEquals(stored.return_to, "/space-settings");
    assertEquals(stored.code_verifier.length >= 43, true);
    assertEquals(stored.expires_at > Date.now(), true);
    assertEquals(
      redirect.searchParams.get("code_challenge"),
      await generateCodeChallenge(stored.code_verifier, "S256"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
