import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../../infra/db/schema.ts";
import { mcpOauthPending, mcpServers } from "../../../../infra/db/schema.ts";
import type { Env, User } from "../../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { createMcpOAuthPending } from "../../../../application/services/platform/mcp/oauth.ts";
import mcpRoutes from "../routes.ts";

const STATE = "s".repeat(43);
const BROWSER_NONCE = "n".repeat(43);
const WRONG_NONCE = "x".repeat(43);
const ISSUER = "https://auth.example/";

function user(id: string): User {
  return {
    id,
    email: `${id}@example.test`,
    name: id,
    username: id,
    bio: null,
    picture: null,
    trust_tier: "new",
    setup_completed: true,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
  };
}

async function createTestContext() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY);
    CREATE TABLE mcp_oauth_pending (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      server_name TEXT NOT NULL,
      server_url TEXT NOT NULL,
      state TEXT NOT NULL UNIQUE,
      code_verifier TEXT NOT NULL,
      issuer_url TEXT NOT NULL,
      token_endpoint TEXT NOT NULL,
      scope TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      authorization_endpoint TEXT,
      authorization_url TEXT,
      redirect_uri TEXT,
      resource_uri TEXT,
      resource_metadata_url TEXT,
      oauth_client_id TEXT,
      oauth_client_secret TEXT,
      oauth_client_id_issued_at INTEGER,
      oauth_client_secret_expires_at INTEGER,
      registration_mode TEXT,
      token_endpoint_auth_method TEXT,
      initiator_user_id TEXT,
      browser_nonce TEXT
    );
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'streamable-http',
      source_type TEXT NOT NULL DEFAULT 'external',
      auth_mode TEXT NOT NULL DEFAULT 'oauth_pkce',
      service_id TEXT,
      bundle_deployment_id TEXT,
      oauth_access_token TEXT,
      oauth_refresh_token TEXT,
      oauth_token_expires_at TEXT,
      oauth_scope TEXT,
      oauth_issuer_url TEXT,
      oauth_resource_uri TEXT,
      oauth_resource_metadata_url TEXT,
      oauth_client_id TEXT,
      oauth_client_secret TEXT,
      oauth_client_id_issued_at INTEGER,
      oauth_client_secret_expires_at INTEGER,
      oauth_registration_mode TEXT,
      oauth_token_endpoint_auth_method TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_mcp_servers_account_name
      ON mcp_servers(account_id, name);
  `);
  const db = drizzle(client, { schema });
  let tokenRequests = 0;
  const env = {
    DB: db as unknown as SqlDatabaseBinding,
    ENVIRONMENT: "production",
    ENCRYPTION_KEY: "mcp-browser-binding-test-encryption-key",
    ADMIN_DOMAIN: "takos.example",
    AUTH_PUBLIC_BASE_URL: "https://takos.example",
    TAKOS_EGRESS: {
      fetch: async (input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        if (url.href !== "https://auth.example/token") {
          throw new Error(`Unexpected egress request: ${url}`);
        }
        tokenRequests += 1;
        return Response.json({
          access_token: "browser-bound-access-token",
          refresh_token: "browser-bound-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    },
  } as unknown as Env;
  const app = new Hono<{
    Bindings: Env;
    Variables: { user: User; spaceId: string; access: never };
  }>();
  app.use("*", async (c, next) => {
    const userId = c.req.header("X-Test-User");
    if (userId) c.set("user", user(userId));
    await next();
  });
  app.route("/api/mcp", mcpRoutes);

  return {
    app,
    client,
    db,
    env,
    tokenRequests: () => tokenRequests,
  };
}

async function createPending(
  context: Awaited<ReturnType<typeof createTestContext>>,
) {
  await createMcpOAuthPending(
    context.db as unknown as SqlDatabaseBinding,
    context.env,
    {
      spaceId: "space-1",
      initiatorUserId: "user-1",
      serverName: "docs",
      serverUrl: "https://connector.example/mcp",
      issuerUrl: ISSUER,
      authorizationEndpoint: "https://auth.example/authorize",
      authorizationUrl: `https://auth.example/authorize?response_type=code&state=${STATE}`,
      tokenEndpoint: "https://auth.example/token",
      redirectUri: "https://takos.example/api/mcp/oauth/callback",
      resourceUri: "https://connector.example/mcp",
      resourceMetadataUrl:
        "https://connector.example/.well-known/oauth-protected-resource/mcp",
      clientId: "https://takos.example/api/mcp/client.json",
      registrationMode: "client_metadata_document",
      tokenEndpointAuthMethod: "none",
      state: STATE,
      codeVerifier: "v".repeat(64),
      browserNonce: BROWSER_NONCE,
    },
  );
}

function callbackUrl(issuer = ISSUER): string {
  const url = new URL("https://takos.example/api/mcp/oauth/callback");
  url.searchParams.set("code", "authorization-code");
  url.searchParams.set("state", STATE);
  url.searchParams.set("iss", issuer);
  return url.href;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0];
}

test("same initiating user starts and completes a browser-bound MCP OAuth flow", async () => {
  const context = await createTestContext();
  try {
    await createPending(context);
    const start = await context.app.request(
      `https://takos.example/api/mcp/oauth/start?state=${STATE}`,
      { headers: { "X-Test-User": "user-1" } },
      context.env,
    );
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toBe(
      `https://auth.example/authorize?response_type=code&state=${STATE}`,
    );
    expect(start.headers.get("referrer-policy")).toBe("no-referrer");
    expect(start.headers.get("cache-control")).toBe("no-store");
    const setCookie = start.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/api/mcp/oauth");
    expect(setCookie).toContain("Max-Age=");
    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(600);

    const callback = await context.app.request(
      callbackUrl(),
      { headers: { Cookie: cookiePair(setCookie) } },
      context.env,
    );
    expect(callback.status).toBe(200);
    expect(callback.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(context.tokenRequests()).toBe(1);
    expect(await context.db.select().from(mcpOauthPending).all()).toHaveLength(
      0,
    );
    expect(await context.db.select().from(mcpServers).all()).toHaveLength(1);
  } finally {
    context.client.close();
  }
});

test("another user cannot start a pending MCP OAuth flow", async () => {
  const context = await createTestContext();
  try {
    await createPending(context);
    const response = await context.app.request(
      `https://takos.example/api/mcp/oauth/start?state=${STATE}`,
      { headers: { "X-Test-User": "user-2" } },
      context.env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await context.db.select().from(mcpOauthPending).all()).toHaveLength(
      1,
    );
    expect(context.tokenRequests()).toBe(0);
  } finally {
    context.client.close();
  }
});

test("callback without the state-specific cookie does not consume pending state", async () => {
  const context = await createTestContext();
  try {
    await createPending(context);
    const response = await context.app.request(callbackUrl(), {}, context.env);
    expect(response.status).toBe(400);
    expect(await context.db.select().from(mcpOauthPending).all()).toHaveLength(
      1,
    );
    expect(context.tokenRequests()).toBe(0);
  } finally {
    context.client.close();
  }
});

test("callback nonce or issuer mismatch leaves pending state intact", async () => {
  const context = await createTestContext();
  try {
    await createPending(context);
    const cookieName = `__Secure-takos_mcp_oauth_${STATE}`;
    const wrongNonce = await context.app.request(
      callbackUrl(),
      { headers: { Cookie: `${cookieName}=${WRONG_NONCE}` } },
      context.env,
    );
    expect(wrongNonce.status).toBe(400);
    expect(await context.db.select().from(mcpOauthPending).all()).toHaveLength(
      1,
    );

    const wrongIssuer = await context.app.request(
      callbackUrl("https://attacker.example/"),
      { headers: { Cookie: `${cookieName}=${BROWSER_NONCE}` } },
      context.env,
    );
    expect(wrongIssuer.status).toBe(400);
    expect(await context.db.select().from(mcpOauthPending).all()).toHaveLength(
      1,
    );
    expect(context.tokenRequests()).toBe(0);
  } finally {
    context.client.close();
  }
});
