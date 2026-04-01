import { Hono } from "hono";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { isAppError } from "takos-common/errors";
import type { Env } from "@/types";
import mcpRoutes, { mcpRouteDeps } from "@/routes/mcp";
import { routeAuthDeps } from "@/routes/route-auth";

type TestUser = { id: string };

function createApp(user?: TestUser) {
  const app = new Hono<{ Bindings: Env; Variables: { user?: TestUser } }>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.route("/mcp", mcpRoutes);
  return app;
}

function makeEnv(): Partial<Env> {
  return {
    DB: {} as Env["DB"],
    ADMIN_DOMAIN: "takos.example.com",
    ENCRYPTION_KEY: "a".repeat(64),
  };
}

function restoreMcpRouteDeps(
  originalDeps: typeof mcpRouteDeps,
  originalRequireSpaceAccess: typeof routeAuthDeps.requireSpaceAccess,
) {
  mcpRouteDeps.consumeMcpOAuthPending = originalDeps.consumeMcpOAuthPending;
  mcpRouteDeps.completeMcpOAuthFlow = originalDeps.completeMcpOAuthFlow;
  mcpRouteDeps.registerExternalMcpServer =
    originalDeps.registerExternalMcpServer;
  mcpRouteDeps.listMcpServers = originalDeps.listMcpServers;
  mcpRouteDeps.deleteMcpServer = originalDeps.deleteMcpServer;
  mcpRouteDeps.updateMcpServer = originalDeps.updateMcpServer;
  mcpRouteDeps.getMcpServerWithTokens = originalDeps.getMcpServerWithTokens;
  mcpRouteDeps.decryptAccessToken = originalDeps.decryptAccessToken;
  mcpRouteDeps.refreshMcpToken = originalDeps.refreshMcpToken;
  routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
}

function stubSpaceAccess(spaceId = "ws1") {
  routeAuthDeps.requireSpaceAccess = (async () => ({
    space: { id: spaceId },
    membership: { role: "owner" },
  })) as any;
}

Deno.test("GET /mcp/oauth/callback - returns 400 when error param is present", async () => {
  const app = createApp();
  const res = await app.request(
    "/mcp/oauth/callback?error=access_denied",
    {},
    makeEnv(),
  );
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), "Authorization Failed");
});

Deno.test("GET /mcp/oauth/callback - returns 400 when code or state missing", async () => {
  const app = createApp();
  const res = await app.request(
    "/mcp/oauth/callback?code=abc",
    {},
    makeEnv(),
  );
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), "Missing code or state");
});

Deno.test("GET /mcp/oauth/callback - returns 400 when state is invalid", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  mcpRouteDeps.consumeMcpOAuthPending =
    (async () => null) as typeof mcpRouteDeps.consumeMcpOAuthPending;

  try {
    const app = createApp();
    const res = await app.request(
      "/mcp/oauth/callback?code=abc&state=bad_state",
      {},
      makeEnv(),
    );
    assertEquals(res.status, 400);
    assertStringIncludes(await res.text(), "Invalid or expired");
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});

Deno.test("GET /mcp/oauth/callback - returns success HTML when callback completes", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  mcpRouteDeps.consumeMcpOAuthPending = (async () => ({
    id: "pending-1",
    spaceId: "ws1",
    serverName: "my_server",
    serverUrl: "https://mcp.example.com",
    issuerUrl: "https://auth.example.com",
    codeVerifier: "verifier",
    tokenEndpoint: "https://auth.example.com/token",
    scope: null,
  })) as typeof mcpRouteDeps.consumeMcpOAuthPending;
  mcpRouteDeps.completeMcpOAuthFlow = (async () => ({
    serverId: "server-1",
  })) as typeof mcpRouteDeps.completeMcpOAuthFlow;

  try {
    const app = createApp();
    const res = await app.request(
      "/mcp/oauth/callback?code=real_code&state=valid_state",
      {},
      makeEnv(),
    );
    assertEquals(res.status, 200);
    const text = await res.text();
    assertStringIncludes(text, "Connected");
    assertStringIncludes(text, "my_server");
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});

Deno.test("GET /mcp/oauth/callback - returns 500 when token exchange fails", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  mcpRouteDeps.consumeMcpOAuthPending = (async () => ({
    id: "pending-1",
    spaceId: "ws1",
    serverName: "srv",
    serverUrl: "https://mcp.example.com",
    issuerUrl: "https://auth.example.com",
    codeVerifier: "verifier",
    tokenEndpoint: "https://auth.example.com/token",
    scope: null,
  })) as typeof mcpRouteDeps.consumeMcpOAuthPending;
  mcpRouteDeps.completeMcpOAuthFlow = (async () => {
    throw new Error("token exchange error");
  }) as typeof mcpRouteDeps.completeMcpOAuthFlow;

  try {
    const app = createApp();
    const res = await app.request(
      "/mcp/oauth/callback?code=code&state=state",
      {},
      makeEnv(),
    );
    assertEquals(res.status, 500);
    assertStringIncludes(await res.text(), "Failed to exchange");
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});

Deno.test("GET /mcp/oauth/callback - prevents replay when pending state is already consumed", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;

  try {
    mcpRouteDeps.consumeMcpOAuthPending = (async () => ({
      id: "pending-1",
      spaceId: "ws1",
      serverName: "srv",
      serverUrl: "https://mcp.example.com",
      issuerUrl: "https://auth.example.com",
      codeVerifier: "verifier",
      tokenEndpoint: "https://auth.example.com/token",
      scope: null,
    })) as typeof mcpRouteDeps.consumeMcpOAuthPending;
    mcpRouteDeps.completeMcpOAuthFlow = (async () => ({
      serverId: "server-1",
    })) as typeof mcpRouteDeps.completeMcpOAuthFlow;

    const app = createApp();
    const res1 = await app.request(
      "/mcp/oauth/callback?code=c&state=st",
      {},
      makeEnv(),
    );
    assertEquals(res1.status, 200);

    mcpRouteDeps.consumeMcpOAuthPending = (async () =>
      null) as typeof mcpRouteDeps.consumeMcpOAuthPending;
    const res2 = await app.request(
      "/mcp/oauth/callback?code=c&state=st",
      {},
      makeEnv(),
    );
    assertEquals(res2.status, 400);
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});

Deno.test("GET /mcp/servers - returns 401 when unauthenticated", async () => {
  const app = createApp();
  const res = await app.request("/mcp/servers?spaceId=ws1", {}, makeEnv());
  assertEquals(res.status, 401);
});

Deno.test("GET /mcp/servers - returns 400 when spaceId is missing", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  stubSpaceAccess();
  mcpRouteDeps.listMcpServers =
    (async () => []) as typeof mcpRouteDeps.listMcpServers;

  try {
    const app = createApp({ id: "user-1" });
    const res = await app.request("/mcp/servers", {}, makeEnv());
    assertEquals(res.status, 400);
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});

Deno.test("GET /mcp/servers - returns server list for an authorized user", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  stubSpaceAccess();
  mcpRouteDeps.listMcpServers = (async () => [
    {
      id: "server-1",
      spaceId: "ws1",
      name: "my_mcp",
      url: "https://mcp.example.com",
      transport: "streamable-http",
      sourceType: "external",
      authMode: "oauth_pkce",
      serviceId: null,
      bundleDeploymentId: null,
      oauthScope: null,
      oauthIssuerUrl: null,
      oauthTokenExpiresAt: null,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ]) as typeof mcpRouteDeps.listMcpServers;

  try {
    const app = createApp({ id: "user-1" });
    const res = await app.request("/mcp/servers?spaceId=ws1", {}, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as {
      data: Array<{ name: string; bundle_deployment_id: string | null }>;
    };
    assertEquals(body.data.length, 1);
    assertEquals(body.data[0].name, "my_mcp");
    assertEquals(body.data[0].bundle_deployment_id, null);
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});

Deno.test("DELETE /mcp/servers/:id - returns 404 when the server does not exist", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  stubSpaceAccess();
  mcpRouteDeps.deleteMcpServer =
    (async () => false) as typeof mcpRouteDeps.deleteMcpServer;

  try {
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/mcp/servers/nonexistent?spaceId=ws1",
      { method: "DELETE" },
      makeEnv(),
    );
    assertEquals(res.status, 404);
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});

Deno.test("DELETE /mcp/servers/:id - deletes and returns success", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  stubSpaceAccess();
  mcpRouteDeps.deleteMcpServer =
    (async () => true) as typeof mcpRouteDeps.deleteMcpServer;

  try {
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/mcp/servers/server-1?spaceId=ws1",
      { method: "DELETE" },
      makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, true);
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});

Deno.test("PATCH /mcp/servers/:id - returns 404 when the server does not exist", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  stubSpaceAccess();
  mcpRouteDeps.updateMcpServer =
    (async () => null) as typeof mcpRouteDeps.updateMcpServer;

  try {
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/mcp/servers/nonexistent?spaceId=ws1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
      makeEnv(),
    );
    assertEquals(res.status, 404);
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});

Deno.test("PATCH /mcp/servers/:id - updates the server and returns the updated record", async () => {
  const originalDeps = { ...mcpRouteDeps };
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  stubSpaceAccess();
  mcpRouteDeps.updateMcpServer = (async () => ({
    id: "server-1",
    spaceId: "ws1",
    name: "my_mcp",
    url: "https://mcp.example.com",
    transport: "streamable-http",
    sourceType: "external",
    authMode: "oauth_pkce",
    serviceId: null,
    bundleDeploymentId: null,
    oauthScope: null,
    oauthIssuerUrl: null,
    oauthTokenExpiresAt: null,
    enabled: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  })) as typeof mcpRouteDeps.updateMcpServer;

  try {
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/mcp/servers/server-1?spaceId=ws1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
      makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as {
      data: { enabled: boolean; bundle_deployment_id: string | null };
    };
    assertEquals(body.data.enabled, false);
    assertEquals(body.data.bundle_deployment_id, null);
  } finally {
    restoreMcpRouteDeps(originalDeps, originalRequireSpaceAccess);
  }
});
