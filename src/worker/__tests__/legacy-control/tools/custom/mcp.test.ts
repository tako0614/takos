import type { SqlDatabaseBinding } from "@/shared/types/bindings.ts";
import type { ToolContext } from "@/tools/types";

import { assert, assertEquals, assertRejects } from "@std/assert";
import { createMockEnv } from "../../../../test/integration/setup.ts";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";
import { noopDep } from "@test/dep-stubs";

import {
  MCP_REMOVE_SERVER,
  mcpAddServerHandler,
  mcpListServersHandler,
  mcpRemoveServerHandler,
} from "@/tools/custom/mcp";

type QueryMethod = "get" | "all" | "run";
type FakeSqlDatabaseBinding = SqlDatabaseBinding & {
  readonly calls: Record<QueryMethod, number>;
};

function createFakeSqlDatabaseBinding(steps: {
  get?: unknown[];
  all?: unknown[];
  run?: unknown[];
} = {}): FakeSqlDatabaseBinding {
  const queues = {
    get: [...(steps.get ?? [])],
    all: [...(steps.all ?? [])],
    run: [...(steps.run ?? [])],
  };
  const calls: Record<QueryMethod, number> = { get: 0, all: 0, run: 0 };

  const take = (method: QueryMethod) => {
    calls[method] += 1;
    return queues[method].length > 0 ? queues[method].shift() : undefined;
  };

  const buildChain = () => {
    let runPromise: Promise<unknown> | null = null;
    const run = () => {
      runPromise ??= Promise.resolve(
        take("run") ?? {
          success: true,
          meta: { changes: 0, last_row_id: 0, duration: 0 },
        },
      );
      return runPromise;
    };
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      values: () => chain,
      onConflictDoUpdate: () => chain,
      get: async () => take("get") ?? null,
      all: async () => {
        const result = take("all");
        return Array.isArray(result) ? result : [];
      },
      run,
      then: (resolve: (value: unknown) => unknown, reject: unknown) =>
        run().then(resolve, reject as (reason: unknown) => unknown),
    };
    return chain;
  };

  return {
    ...noopSqlDatabaseBinding(),
    select: buildChain,
    insert: buildChain,
    update: buildChain,
    delete: buildChain,
    calls,
  } as FakeSqlDatabaseBinding;
}

function makeContext(
  overrides: Partial<ToolContext> = {},
  db: SqlDatabaseBinding = createFakeSqlDatabaseBinding(),
): ToolContext {
  return {
    spaceId: "ws_test",
    threadId: "th_test",
    runId: "run_test",
    userId: "user_test",
    capabilities: ["egress.http"],
    env: createMockEnv({
      ENVIRONMENT: "production",
      ADMIN_DOMAIN: "takos.example.com",
      ENCRYPTION_KEY: "a".repeat(64),
    }),
    db,
    setSessionId: noopDep<ToolContext["setSessionId"]>("setSessionId"),
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: noopDep<
      ToolContext["setLastContainerStartFailure"]
    >("setLastContainerStartFailure"),
    ...overrides,
  };
}

function mockOAuthMetadataFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
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
    )) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function mockOAuthDiscoveryFailure(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("not found", {
      status: 404,
      statusText: "Not Found",
    })) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
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
  const restoreFetch = mockOAuthDiscoveryFailure();
  const db = createFakeSqlDatabaseBinding({ get: [null], run: [{}] });
  const ctx = makeContext({
    env: createMockEnv({
      ENVIRONMENT: "development",
      ADMIN_DOMAIN: "localhost",
      ENCRYPTION_KEY: "a".repeat(64),
    }),
  }, db);

  try {
    const result = JSON.parse(
      await mcpAddServerHandler(
        { url: "http://localhost:8080", name: "local_srv" },
        ctx,
      ),
    );

    assertEquals(result.status, "registered");
  } finally {
    restoreFetch();
  }
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
  fn: async () => {
    const db = createFakeSqlDatabaseBinding({
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
  const restoreFetch = mockOAuthDiscoveryFailure();
  const db = createFakeSqlDatabaseBinding({ get: [null], run: [{}] });

  try {
    const result = JSON.parse(
      await mcpAddServerHandler(
        { url: "https://mcp.example.com", name: "noauth_srv" },
        makeContext({}, db),
      ),
    );

    assertEquals(result.status, "registered");
  } finally {
    restoreFetch();
  }
});

Deno.test("mcp_add_server - returns pending_oauth when OAuth metadata discovered", async () => {
  const restoreFetch = mockOAuthMetadataFetch();
  const db = createFakeSqlDatabaseBinding({ get: [null], run: [{}] });

  try {
    const result = JSON.parse(
      await mcpAddServerHandler(
        { url: "https://mcp.example.com", name: "oauth_srv" },
        makeContext({}, db),
      ),
    );

    assertEquals(result.status, "pending_oauth");
    assert(result.auth_url);
  } finally {
    restoreFetch();
  }
});

Deno.test({
  name: "mcp_list_servers - returns list of servers",
  fn: async () => {
    const db = createFakeSqlDatabaseBinding({
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
  const db = createFakeSqlDatabaseBinding({ all: [[]] });

  const result = JSON.parse(
    await mcpListServersHandler({}, makeContext({}, db)),
  );
  assertEquals(result.count, 0);
  assertEquals(result.servers, []);
});

Deno.test("mcp_remove_server - returns not_found when server does not exist", async () => {
  const db = createFakeSqlDatabaseBinding({ get: [null] });

  const result = JSON.parse(
    await mcpRemoveServerHandler({ id: "missing" }, makeContext({}, db)),
  );
  assertEquals(result.status, "not_found");
});

Deno.test("mcp_remove_server - requires id", async () => {
  const db = createFakeSqlDatabaseBinding();

  assertEquals(MCP_REMOVE_SERVER.parameters.required, ["id"]);
  assertEquals(
    "name" in MCP_REMOVE_SERVER.parameters.properties,
    false,
  );

  await assertRejects(
    () => mcpRemoveServerHandler({ name: "my_mcp" }, makeContext({}, db)),
    Error,
    "id is required",
  );
  assertEquals(db.calls.get, 0);
});

Deno.test({
  name: "mcp_remove_server - deletes and returns removed status",
  fn: async () => {
    const db = createFakeSqlDatabaseBinding({
      get: [{
        id: "s1",
        name: "my_mcp",
      }, {
        id: "s1",
        sourceType: "external",
      }],
      run: [{}],
    });

    const result = JSON.parse(
      await mcpRemoveServerHandler({ id: "s1" }, makeContext({}, db)),
    );
    assertEquals(result.status, "removed");
    assertEquals(db.calls.run, 1);
  },
});
