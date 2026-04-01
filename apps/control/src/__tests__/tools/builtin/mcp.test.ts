import type { D1Database } from "@cloudflare/workers-types";
import type { ToolContext } from "../../../../../../packages/control/src/application/tools/tool-definitions.ts";
import type { Env } from "../../../../../../packages/control/src/shared/types/index.ts";

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";

import {
  mcpAddServerHandler,
  mcpListServersHandler,
  mcpRemoveServerHandler,
} from "../../../../../../packages/control/src/application/tools/builtin/mcp.ts";

type QueryMethod = "get" | "all" | "run";

function createFakeD1Database(steps: {
  get?: unknown[];
  all?: unknown[];
  run?: unknown[];
} = {}): D1Database {
  const queues = {
    get: [...(steps.get ?? [])],
    all: [...(steps.all ?? [])],
    run: [...(steps.run ?? [])],
  };

  const take = (method: QueryMethod) =>
    queues[method].length > 0 ? queues[method].shift() : undefined;

  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            get: async () => take("get") ?? null,
            all: async () => {
              const result = take("all");
              const rows = Array.isArray(result) ? result : [];
              return { results: rows, success: true, meta: {} };
            },
            run: async () => {
              const result = take("run");
              return result ?? {
                success: true,
                meta: { changes: 0, last_row_id: 0, duration: 0 },
              };
            },
            raw: async () => {
              const result = take("all");
              return Array.isArray(result) ? result : [];
            },
          };
        },
      };
    },
    batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
}

function makeContext(
  overrides: Partial<ToolContext> = {},
  db: D1Database = createFakeD1Database(),
): ToolContext {
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
    db,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

function mockOAuthMetadataFetch(): void {
  (globalThis as any).fetch = async () =>
    new Response(
      JSON.stringify({
        issuer: "https://mcp.example.com",
        authorization_endpoint: "https://auth.example.com/auth",
        token_endpoint: "https://auth.example.com/token",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
}

function mockOAuthDiscoveryFailure(): void {
  (globalThis as any).fetch = async () =>
    new Response("not found", {
      status: 404,
      statusText: "Not Found",
    });
}

Deno.test("mcp_add_server - rejects non-HTTPS URLs in production", async () => {
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
  mockOAuthDiscoveryFailure();
  const db = createFakeD1Database({ get: [null], run: [{}] });
  const ctx = makeContext({
    env: {
      ENVIRONMENT: "development",
      ADMIN_DOMAIN: "localhost",
      ENCRYPTION_KEY: "a".repeat(64),
    } as unknown as Env,
  }, db);

  const result = JSON.parse(
    await mcpAddServerHandler(
      { url: "http://localhost:8080", name: "local_srv" },
      ctx,
    ),
  );

  assertEquals(result.status, "registered");
});

Deno.test("mcp_add_server - rejects invalid server names", async () => {
  await assertRejects(
    () =>
      mcpAddServerHandler(
        { url: "https://mcp.example.com", name: "123invalid" },
        makeContext(),
      ),
    "name must start with a letter",
  );
});

Deno.test({
  name: "mcp_add_server - returns already_registered when server has token",
  ignore: true,
  fn: async () => {
    const db = createFakeD1Database({
      get: [{
        id: "srv-1",
        oauthAccessToken: "encrypted-token",
      }],
    });

    const result = JSON.parse(
      await mcpAddServerHandler(
        { url: "https://mcp.example.com", name: "my_mcp" },
        makeContext({}, db),
      ),
    );

    assertEquals(result.status, "already_registered");
  },
});

Deno.test("mcp_add_server - registers without OAuth when discovery fails", async () => {
  mockOAuthDiscoveryFailure();
  const db = createFakeD1Database({ get: [null], run: [{}] });

  const result = JSON.parse(
    await mcpAddServerHandler(
      { url: "https://mcp.example.com", name: "noauth_srv" },
      makeContext({}, db),
    ),
  );

  assertEquals(result.status, "registered");
});

Deno.test("mcp_add_server - returns pending_oauth when OAuth metadata discovered", async () => {
  mockOAuthMetadataFetch();
  const db = createFakeD1Database({ get: [null], run: [{}] });

  const result = JSON.parse(
    await mcpAddServerHandler(
      { url: "https://mcp.example.com", name: "oauth_srv" },
      makeContext({}, db),
    ),
  );

  assertEquals(result.status, "pending_oauth");
  assert(result.auth_url);
});

Deno.test({
  name: "mcp_list_servers - returns list of servers",
  ignore: true,
  fn: async () => {
    const db = createFakeD1Database({
      all: [[
        {
          id: "s1",
          accountId: "ws_test",
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
      ]],
    });

    const result = JSON.parse(
      await mcpListServersHandler({}, makeContext({}, db)),
    );

    assertEquals(result.count, 1);
    assertEquals(result.servers[0].name, "my_mcp");
    assertEquals(result.servers[0].enabled, true);
    assertEquals(result.servers[0].bundle_deployment_id, null);
  },
});

Deno.test("mcp_list_servers - returns empty list when no servers registered", async () => {
  const db = createFakeD1Database({ all: [[]] });

  const result = JSON.parse(
    await mcpListServersHandler({}, makeContext({}, db)),
  );
  assertEquals(result.count, 0);
  assertEquals(result.servers, []);
});

Deno.test("mcp_remove_server - returns not_found when server does not exist", async () => {
  const db = createFakeD1Database({ get: [null] });

  const result = JSON.parse(
    await mcpRemoveServerHandler({ name: "missing" }, makeContext({}, db)),
  );
  assertEquals(result.status, "not_found");
});

Deno.test({
  name: "mcp_remove_server - deletes and returns removed status",
  ignore: true,
  fn: async () => {
    const db = createFakeD1Database({
      get: [{
        id: "s1",
        sourceType: "external",
      }],
      run: [{}],
    });

    const result = JSON.parse(
      await mcpRemoveServerHandler({ name: "my_mcp" }, makeContext({}, db)),
    );
    assertEquals(result.status, "removed");
  },
});
