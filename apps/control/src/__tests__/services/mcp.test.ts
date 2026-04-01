import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): D1Database {
  return {} as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENCRYPTION_KEY: "a".repeat(64), // 32-byte hex key
    ADMIN_DOMAIN: "takos.example.com",
    ...overrides,
  } as unknown as Env;
}

/**
 * Build a chainable Drizzle mock.
 * Supports select/insert/update/delete chains.
 */
function createDrizzleMock(options: {
  selectGet?: unknown;
  selectAll?: unknown[];
} = {}) {
  const runFn = async () => undefined;

  const selectChain = {
    get: async () => options.selectGet,
    all: async () => options.selectAll ?? [],
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    offset: function (this: any) {
      return this;
    },
  };
  const selectFrom = {
    where: () => selectChain,
    get: async () => options.selectGet,
    all: async () => options.selectAll ?? [],
    orderBy: () => selectChain,
  };

  return {
    select: () => ({ from: () => selectFrom }),
    insert: spy(() => ({
      values: () => ({
        returning: () => ({ get: async () => ({}) }),
        run: runFn,
      }),
    })),
    update: spy(() => ({
      set: () => ({
        where: () => ({ run: runFn }),
        run: runFn,
      }),
    })),
    delete: spy(() => ({
      where: () => ({ run: runFn }),
      run: runFn,
    })),
  };
}

// ---------------------------------------------------------------------------
// discoverOAuthMetadata
// ---------------------------------------------------------------------------

import { discoverOAuthMetadata, mcpServiceDeps } from "@/services/platform/mcp";

function syncMcpDeps() {
  mcpServiceDeps.getDb = mocks.getDb;
}

Deno.test("discoverOAuthMetadata - returns parsed metadata on 200 response", async () => {
  const meta = {
    issuer: "https://auth.example.com",
    authorization_endpoint: "https://auth.example.com/auth",
    token_endpoint: "https://auth.example.com/token",
  };

  globalThis.fetch = async () => ({
    ok: true,
    json: () => Promise.resolve(meta),
  } as unknown as Response);

  const result = await discoverOAuthMetadata("https://mcp.example.com");

  assertEquals(result.issuer, "https://auth.example.com");
  assertEquals(result.token_endpoint, "https://auth.example.com/token");
});
Deno.test("discoverOAuthMetadata - throws when server returns non-200", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
  } as unknown as Response);

  await assertRejects(async () => {
    await discoverOAuthMetadata("https://mcp.example.com");
  }, "OAuth metadata discovery failed");
});
Deno.test("discoverOAuthMetadata - throws when required fields are missing", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: () => Promise.resolve({ issuer: "https://auth.example.com" }),
  } as unknown as Response);

  await assertRejects(async () => {
    await discoverOAuthMetadata("https://mcp.example.com");
  }, "missing required fields");
});
// ---------------------------------------------------------------------------
// createMcpOAuthPending
// ---------------------------------------------------------------------------

import { createMcpOAuthPending } from "@/services/platform/mcp";

Deno.test("createMcpOAuthPending - creates a pending record and returns an auth URL", async () => {
  const drizzleMock = createDrizzleMock();
  mocks.getDb = (() => drizzleMock) as any;
  syncMcpDeps();
  const db = makeDb();
  const env = makeEnv();

  const { authUrl, state } = await createMcpOAuthPending(db, env, {
    spaceId: "ws1",
    serverName: "my_mcp",
    serverUrl: "https://mcp.example.com",
    issuerUrl: "https://auth.example.com",
    tokenEndpoint: "https://auth.example.com/token",
    authorizationEndpoint: "https://auth.example.com/auth",
    redirectUri: "https://takos.example.com/api/mcp/oauth/callback",
  });

  assert(state);
  assertStringIncludes(authUrl, "https://auth.example.com/auth");
  assertStringIncludes(authUrl, "code_challenge_method=S256");
  assertStringIncludes(authUrl, `state=${state}`);
  assertSpyCalls(drizzleMock.insert, 1);
});
Deno.test("createMcpOAuthPending - throws when ENCRYPTION_KEY is not configured", async () => {
  const db = makeDb();
  const env = makeEnv({ ENCRYPTION_KEY: undefined });

  await assertRejects(async () => {
    await createMcpOAuthPending(db, env, {
      spaceId: "ws1",
      serverName: "srv",
      serverUrl: "https://mcp.example.com",
      issuerUrl: "https://auth.example.com",
      tokenEndpoint: "https://auth.example.com/token",
      authorizationEndpoint: "https://auth.example.com/auth",
      redirectUri: "https://takos.example.com/api/mcp/oauth/callback",
    });
  }, "ENCRYPTION_KEY");
});
// ---------------------------------------------------------------------------
// consumeMcpOAuthPending
// ---------------------------------------------------------------------------

import { consumeMcpOAuthPending } from "@/services/platform/mcp";

Deno.test("consumeMcpOAuthPending - returns null when state is not found", async () => {
  const drizzleMock = createDrizzleMock({ selectGet: undefined });
  mocks.getDb = (() => drizzleMock) as any;
  syncMcpDeps();

  const result = await consumeMcpOAuthPending(
    makeDb(),
    makeEnv(),
    "unknown_state",
  );
  assertEquals(result, null);
});
Deno.test("consumeMcpOAuthPending - returns null and deletes expired record", async () => {
  const drizzleMock = createDrizzleMock({
    selectGet: {
      id: "p1",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      state: "st",
      accountId: "ws1",
      serverName: "srv",
      serverUrl: "https://mcp.example.com",
      issuerUrl: "https://auth.example.com",
      codeVerifier: "{}",
      tokenEndpoint: "https://auth.example.com/token",
      scope: null,
    },
  });
  mocks.getDb = (() => drizzleMock) as any;
  syncMcpDeps();

  const result = await consumeMcpOAuthPending(makeDb(), makeEnv(), "st");
  assertEquals(result, null);
  assert(drizzleMock.delete.calls.length > 0);
});
Deno.test("consumeMcpOAuthPending - returns null when record does not exist", async () => {
  const drizzleMock = createDrizzleMock({ selectGet: undefined });
  mocks.getDb = (() => drizzleMock) as any;
  syncMcpDeps();

  const result = await consumeMcpOAuthPending(
    makeDb(),
    makeEnv(),
    "some_state",
  );
  assertEquals(result, null);
});
// ---------------------------------------------------------------------------
// listMcpServers / deleteMcpServer / updateMcpServer
// ---------------------------------------------------------------------------

import {
  deleteMcpServer,
  listMcpServers,
  updateMcpServer,
} from "@/services/platform/mcp";

Deno.test("listMcpServers - returns mapped server records", async () => {
  const serverRow = {
    id: "s1",
    accountId: "ws1",
    name: "my_mcp",
    url: "https://mcp.example.com",
    transport: "streamable-http",
    sourceType: "external",
    authMode: "oauth_pkce",
    serviceId: null,
    bundleDeploymentId: null,
    oauthScope: "read",
    oauthIssuerUrl: "https://auth.example.com",
    oauthTokenExpiresAt: null,
    enabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
  const drizzleMock = createDrizzleMock({ selectAll: [serverRow] });
  mocks.getDb = (() => drizzleMock) as any;
  syncMcpDeps();

  const servers = await listMcpServers(makeDb(), "ws1");

  assertEquals(servers.length, 1);
  assertEquals(servers[0].name, "my_mcp");
  assertEquals(servers[0].enabled, true);
  assertEquals(servers[0].bundleDeploymentId, null);
});

Deno.test("deleteMcpServer - returns false when server not found", async () => {
  const drizzleMock = createDrizzleMock({ selectGet: undefined });
  mocks.getDb = (() => drizzleMock) as any;
  syncMcpDeps();

  const result = await deleteMcpServer(makeDb(), "ws1", "nonexistent");
  assertEquals(result, false);
});
Deno.test("deleteMcpServer - deletes and returns true when found", async () => {
  const drizzleMock = createDrizzleMock({
    selectGet: { id: "s1", sourceType: "external" },
  });
  mocks.getDb = (() => drizzleMock) as any;
  syncMcpDeps();

  const result = await deleteMcpServer(makeDb(), "ws1", "s1");
  assertEquals(result, true);
  assertSpyCalls(drizzleMock.delete, 1);
});

Deno.test("updateMcpServer - returns null when server not found", async () => {
  const drizzleMock = createDrizzleMock({ selectGet: undefined });
  mocks.getDb = (() => drizzleMock) as any;
  syncMcpDeps();

  const result = await updateMcpServer(makeDb(), "ws1", "nonexistent", {
    enabled: false,
  });
  assertEquals(result, null);
});
Deno.test("updateMcpServer - updates enabled flag", async () => {
  const updatedRow = {
    id: "s1",
    accountId: "ws1",
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
  };

  let selectCallIdx = 0;
  const selectResults = [
    { id: "s1", sourceType: "external" },
    updatedRow,
  ];

  const runFn = async () => undefined;
  const drizzleMock = {
    select: () => {
      const result = selectResults[selectCallIdx++];
      const chain = {
        get: async () => result,
        all: async () => [],
      };
      return {
        from: () => ({
          where: () => chain,
          get: async () => result,
          all: async () => [],
        }),
      };
    },
    update: () => ({
      set: () => ({
        where: () => ({ run: runFn }),
      }),
    }),
    delete: () => ({
      where: () => ({ run: runFn }),
    }),
  };
  mocks.getDb = (() => drizzleMock) as any;
  syncMcpDeps();

  const result = await updateMcpServer(makeDb(), "ws1", "s1", {
    enabled: false,
  });
  assertNotEquals(result, null);
  assertEquals(result?.enabled, false);
  assertEquals(result?.bundleDeploymentId, null);
});
