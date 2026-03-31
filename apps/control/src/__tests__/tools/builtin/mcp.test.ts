import type { ToolContext } from "../../../../../../packages/control/src/application/tools/tool-definitions.ts";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../../../../../../packages/control/src/shared/types/index.ts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";

const mockSelectGet = ((..._args: any[]) => undefined) as any;

const mockDb = {
  mcpServer: {
    findFirst: ((..._args: any[]) => undefined) as any,
    create: ((..._args: any[]) => undefined) as any,
    update: ((..._args: any[]) => undefined) as any,
    upsert: ((..._args: any[]) => undefined) as any,
    findMany: ((..._args: any[]) => undefined) as any,
    delete: ((..._args: any[]) => undefined) as any,
  },
  mcpOAuthPending: {
    create: ((..._args: any[]) => undefined) as any,
  },
  // Drizzle-chainable select: db.select({...}).from(table).where(...).get()
  select: () => {
    const chain = {
      from: () => chain,
      where: () => chain,
      get: () => mockSelectGet(),
      all: () => mockSelectGet(),
    };
    return chain;
  },
  // Drizzle-chainable insert: db.insert(table).values({...}).run()
  insert: () => ({
    values: () => ({
      run: async () => ({}),
      onConflictDoUpdate: () => ({
        run: async () => ({}),
      }),
    }),
  }),
  // Drizzle-chainable update: db.update(table).set({...}).where(...)
  update: () => ({
    set: () => ({
      where: async () => ({}),
      run: async () => ({}),
    }),
  }),
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '../../../../../../packages/control/src/application/services/platform/mcp.ts'
import {
  createMcpOAuthPending as realCreateMcpOAuthPending,
  deleteMcpServer as realDeleteMcpServer,
  discoverOAuthMetadata as realDiscoverOAuthMetadata,
  listMcpServers as realListMcpServers,
  registerExternalMcpServer as realRegisterExternalMcpServer,
} from "../../../../../../packages/control/src/application/services/platform/mcp.ts";

let registerExternalMcpServer = realRegisterExternalMcpServer;
let discoverOAuthMetadata = realDiscoverOAuthMetadata;
let createMcpOAuthPending = realCreateMcpOAuthPending;
let listMcpServers = realListMcpServers;
let deleteMcpServer = realDeleteMcpServer;

import {
  mcpAddServerHandler,
  mcpListServersHandler,
  mcpRemoveServerHandler,
} from "../../../../../../packages/control/src/application/tools/builtin/mcp.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws_test",
    threadId: "th_test",
    runId: "run_test",
    userId: "user_test",
    capabilities: ["egress.http"],
    env: {
      ENVIRONMENT: "production",
      ADMIN_DOMAIN: "takos.example.com",
      ENCRYPTION_KEY: "a".repeat(64),
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mcp_add_server
// ---------------------------------------------------------------------------

Deno.test("mcp_add_server - rejects non-HTTPS URLs in production", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  registerExternalMcpServer = (async (
    ...args: [
      D1Database,
      Env,
      { spaceId: string; name: string; url: string; scope?: string },
    ]
  ) => {
    const actual = await import(
      "../../../../../../packages/control/src/application/services/platform/mcp.ts"
    );
    return actual.registerExternalMcpServer(...args);
  }) as any;
  mockDb.mcpServer.findFirst = (async () => null) as any;
  mockDb.mcpServer.create = (async () => ({})) as any;
  // Drizzle select chain returns null by default (no existing server)
  await assertRejects(
    () =>
      mcpAddServerHandler(
        { url: "http://evil.com", name: "bad" },
        makeContext(),
      ),
    "must use HTTPS",
  );
});
Deno.test("mcp_add_server - allows http in development environment", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  registerExternalMcpServer = (async (
    ...args: [
      D1Database,
      Env,
      { spaceId: string; name: string; url: string; scope?: string },
    ]
  ) => {
    const actual = await import(
      "../../../../../../packages/control/src/application/services/platform/mcp.ts"
    );
    return actual.registerExternalMcpServer(...args);
  }) as any;
  mockDb.mcpServer.findFirst = (async () => null) as any;
  mockDb.mcpServer.create = (async () => ({})) as any;
  // Drizzle select chain returns null by default (no existing server)
  discoverOAuthMetadata = (async () => {
    throw new Error("no metadata");
  }) as any;

  const ctx = makeContext({
    env: {
      ENVIRONMENT: "development",
      ADMIN_DOMAIN: "localhost",
      ENCRYPTION_KEY: "a".repeat(64),
    } as unknown as Env,
  });
  const result = JSON.parse(
    await mcpAddServerHandler({
      url: "http://localhost:8080",
      name: "local_srv",
    }, ctx),
  );

  assertEquals(result.status, "registered");
});
Deno.test("mcp_add_server - rejects invalid server names", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  registerExternalMcpServer = (async (
    ...args: [
      D1Database,
      Env,
      { spaceId: string; name: string; url: string; scope?: string },
    ]
  ) => {
    const actual = await import(
      "../../../../../../packages/control/src/application/services/platform/mcp.ts"
    );
    return actual.registerExternalMcpServer(...args);
  }) as any;
  mockDb.mcpServer.findFirst = (async () => null) as any;
  mockDb.mcpServer.create = (async () => ({})) as any;
  // Drizzle select chain returns null by default (no existing server)
  await assertRejects(() =>
    mcpAddServerHandler(
      { url: "https://mcp.example.com", name: "123invalid" },
      makeContext(),
    ), "name must start with a letter");
});
Deno.test("mcp_add_server - returns already_registered when server has token", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  registerExternalMcpServer = (async (
    ...args: [
      D1Database,
      Env,
      { spaceId: string; name: string; url: string; scope?: string },
    ]
  ) => {
    const actual = await import(
      "../../../../../../packages/control/src/application/services/platform/mcp.ts"
    );
    return actual.registerExternalMcpServer(...args);
  }) as any;
  mockDb.mcpServer.findFirst = (async () => null) as any;
  mockDb.mcpServer.create = (async () => ({})) as any;
  // Drizzle select chain returns null by default (no existing server)
  registerExternalMcpServer = (async () => ({
    status: "already_registered",
    name: "my_mcp",
    url: "https://mcp.example.com",
    message: "already registered",
  })) as any;

  const result = JSON.parse(
    await mcpAddServerHandler(
      { url: "https://mcp.example.com", name: "my_mcp" },
      makeContext(),
    ),
  );

  assertEquals(result.status, "already_registered");
});
Deno.test("mcp_add_server - registers without OAuth when discovery fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  registerExternalMcpServer = (async (
    ...args: [
      D1Database,
      Env,
      { spaceId: string; name: string; url: string; scope?: string },
    ]
  ) => {
    const actual = await import(
      "../../../../../../packages/control/src/application/services/platform/mcp.ts"
    );
    return actual.registerExternalMcpServer(...args);
  }) as any;
  mockDb.mcpServer.findFirst = (async () => null) as any;
  mockDb.mcpServer.create = (async () => ({})) as any;
  // Drizzle select chain returns null by default (no existing server)
  registerExternalMcpServer = (async () => ({
    status: "registered",
    name: "noauth_srv",
    url: "https://mcp.example.com",
    message: "registered without oauth",
  })) as any;

  const result = JSON.parse(
    await mcpAddServerHandler(
      { url: "https://mcp.example.com", name: "noauth_srv" },
      makeContext(),
    ),
  );

  assertEquals(result.status, "registered");
});
Deno.test("mcp_add_server - returns pending_oauth when OAuth metadata discovered", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  registerExternalMcpServer = (async (
    ...args: [
      D1Database,
      Env,
      { spaceId: string; name: string; url: string; scope?: string },
    ]
  ) => {
    const actual = await import(
      "../../../../../../packages/control/src/application/services/platform/mcp.ts"
    );
    return actual.registerExternalMcpServer(...args);
  }) as any;
  mockDb.mcpServer.findFirst = (async () => null) as any;
  mockDb.mcpServer.create = (async () => ({})) as any;
  // Drizzle select chain returns null by default (no existing server)
  registerExternalMcpServer = (async () => ({
    status: "pending_oauth",
    name: "oauth_srv",
    url: "https://mcp.example.com",
    authUrl: "https://auth.example.com/auth?client_id=takos",
    message: "authorize this server",
  })) as any;

  const result = JSON.parse(
    await mcpAddServerHandler(
      { url: "https://mcp.example.com", name: "oauth_srv" },
      makeContext(),
    ),
  );

  assertEquals(result.status, "pending_oauth");
  assert(result.auth_url);
});
// ---------------------------------------------------------------------------
// mcp_list_servers
// ---------------------------------------------------------------------------

Deno.test("mcp_list_servers - returns list of servers", async () => {
  listMcpServers = (async () => [
    {
      id: "s1",
      spaceId: "ws_test",
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
    },
  ]) as any;

  const result = JSON.parse(await mcpListServersHandler({}, makeContext()));

  assertEquals(result.count, 1);
  assertEquals(result.servers[0].name, "my_mcp");
  assertEquals(result.servers[0].enabled, true);
  assertEquals(result.servers[0].bundle_deployment_id, null);
});
Deno.test("mcp_list_servers - returns empty list when no servers registered", async () => {
  listMcpServers = (async () => []) as any;

  const result = JSON.parse(await mcpListServersHandler({}, makeContext()));
  assertEquals(result.count, 0);
  assertEquals(result.servers, []);
});
// ---------------------------------------------------------------------------
// mcp_remove_server
// ---------------------------------------------------------------------------

Deno.test("mcp_remove_server - returns not_found when server does not exist", async () => {
  const result = JSON.parse(
    await mcpRemoveServerHandler({ name: "missing" }, makeContext()),
  );
  assertEquals(result.status, "not_found");
});
Deno.test("mcp_remove_server - deletes and returns removed status", async () => {
  const result = JSON.parse(
    await mcpRemoveServerHandler({ name: "my_mcp" }, makeContext()),
  );
  assertEquals(result.status, "removed");
});
