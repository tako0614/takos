import { test } from "bun:test";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@takos/test/assert";
import { stub } from "@takos/test/mock";

import {
  listMcpServers,
  registerExternalMcpServer,
  resolvePublicationMcpServerAccessToken,
  updateMcpServer,
} from "../mcp/crud.ts";
import { mcpRemoveServerHandler } from "../../../tools/custom/mcp.ts";
import { loadMcpTools } from "../../../tools/mcp-tools.ts";
import { McpClient } from "../../../tools/mcp-client.ts";
import {
  mcpServers,
  mcpToolPolicies,
  publications,
} from "../../../../infra/db/index.ts";
import type { Env } from "../../../../shared/types/index.ts";
import { fingerprintMcpTool } from "../mcp/tool-policy.ts";

type DbTableRows = {
  mcpServers: Array<Record<string, unknown>>;
  mcpToolPolicies?: Array<Record<string, unknown>>;
  publications: Array<Record<string, unknown>>;
};

function makeRowTable(rows: Array<Record<string, unknown>>) {
  return {
    where: () => ({
      orderBy: () => ({
        all: () => Promise.resolve(rows),
      }),
      get: () => Promise.resolve(rows[0] ?? null),
      all: () => Promise.resolve(rows),
    }),
    orderBy: () => ({
      all: () => Promise.resolve(rows),
    }),
    get: () => Promise.resolve(rows[0] ?? null),
    all: () => Promise.resolve(rows),
  };
}

function makeDb(rows: DbTableRows) {
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === mcpServers) return makeRowTable(rows.mcpServers);
        if (table === mcpToolPolicies) {
          return makeRowTable(rows.mcpToolPolicies ?? []);
        }
        if (table === publications) return makeRowTable(rows.publications);
        return makeRowTable([]);
      },
    }),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        if (table === mcpServers) rows.mcpServers.push(value);
        return {
          onConflictDoUpdate: () => undefined,
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          run: () => undefined,
        }),
      }),
    }),
    delete: () => ({
      where: () => undefined,
    }),
  } as never;
}

function makeMcpEnv(rows: DbTableRows): unknown {
  return {
    DB: makeDb(rows),
    ENCRYPTION_KEY: "test-key",
  };
}

function publicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pub_1",
    accountId: "space_1",
    groupId: null,
    ownerServiceId: "svc_1",
    sourceType: "runtime_projection",
    name: "shared-mcp",
    catalogName: null,
    publicationType: "protocol.mcp.server",
    specJson: JSON.stringify({
      name: "shared-mcp",
      publisher: "web",
      type: "protocol.mcp.server",
      outputs: { url: { kind: "url", routeRef: "mcp" } },
    }),
    resolvedJson: JSON.stringify({
      url: "https://published.example/mcp",
    }),
    status: "active",
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:00:00.000Z",
    ...overrides,
  };
}

function externalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "srv_1",
    accountId: "space_1",
    name: "shared-mcp",
    url: "https://external.example/mcp",
    transport: "streamable-http",
    sourceType: "external",
    authMode: "oauth_pkce",
    serviceId: null,
    bundleDeploymentId: null,
    oauthAccessToken: null,
    oauthRefreshToken: null,
    oauthTokenExpiresAt: null,
    oauthScope: null,
    oauthIssuerUrl: null,
    enabled: true,
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:00:00.000Z",
    ...overrides,
  };
}

test("registerExternalMcpServer rejects a name already published in the space", async () => {
  const env = makeMcpEnv({
    mcpServers: [],
    publications: [publicationRow()],
  }) as unknown as Env;

  await assertRejects(
    () =>
      registerExternalMcpServer(env.DB, env as Env, {
        spaceId: "space_1",
        initiatorUserId: "user-1",
        name: "shared-mcp",
        url: "https://external.example/mcp",
      }),
    Error,
    'MCP server "shared-mcp" already exists as a publication in this space',
  );
});

test("registerExternalMcpServer rejects reusing a Workspace name for a different endpoint", async () => {
  const env = makeMcpEnv({
    mcpServers: [
      externalRow({
        name: "docs",
        url: "https://connector-a.example/mcp",
        oauthAccessToken: "encrypted-token",
      }),
    ],
    publications: [],
  }) as unknown as Env;

  await assertRejects(
    () =>
      registerExternalMcpServer(env.DB, env, {
        spaceId: "space_1",
        initiatorUserId: "user-1",
        name: "docs",
        url: "https://connector-b.example/mcp",
      }),
    Error,
    'MCP server "docs" is already bound to a different endpoint',
  );
});

test("registerExternalMcpServer reports the stored endpoint for normalized same-URL reuse", async () => {
  const storedUrl = "https://connector.example:443/mcp#local-fragment";
  const env = makeMcpEnv({
    mcpServers: [
      externalRow({
        name: "docs",
        url: storedUrl,
        oauthAccessToken: "encrypted-token",
      }),
    ],
    publications: [],
  }) as unknown as Env;

  const result = await registerExternalMcpServer(env.DB, env, {
    spaceId: "space_1",
    initiatorUserId: "user-1",
    name: "docs",
    url: "HTTPS://CONNECTOR.EXAMPLE/mcp",
  });

  assertEquals(result.status, "already_registered");
  assertEquals(result.url, storedUrl);
  assertStringIncludes(result.message, "for this endpoint");
});

test("registerExternalMcpServer persists a validated public server as auth_mode none", async () => {
  const rows: DbTableRows = { mcpServers: [], publications: [] };
  const env = {
    ...(makeMcpEnv(rows) as Record<string, unknown>),
    ENVIRONMENT: "production",
    ADMIN_DOMAIN: "takos.example",
    AUTH_PUBLIC_BASE_URL: "https://takos.example",
    TAKOS_EGRESS: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input.toString());
        const message =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as { method?: string })
            : null;
        if (url.href === "https://public.example/mcp") {
          if (message?.method === "initialize") {
            return Response.json({
              jsonrpc: "2.0",
              id: "takos-oauth-discovery",
              result: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                serverInfo: { name: "public", version: "1" },
              },
            });
          }
          if (message?.method === "notifications/initialized") {
            return new Response(null, { status: 202 });
          }
        }
        if (url.pathname.includes(".well-known/oauth-protected-resource")) {
          return new Response(null, { status: 404 });
        }
        throw new Error(`Unexpected public MCP request: ${url}`);
      },
    },
  } as unknown as Env;

  const result = await registerExternalMcpServer(env.DB, env, {
    spaceId: "space_1",
    initiatorUserId: "user-1",
    name: "public-tools",
    url: "https://public.example/mcp",
  });
  assertEquals(result.status, "registered");
  assertEquals(rows.mcpServers[0]?.authMode, "none");
  assertEquals(rows.mcpServers[0]?.oauthAccessToken, undefined);
});

test("updateMcpServer rejects rename collisions with published MCP servers", async () => {
  const env = makeMcpEnv({
    mcpServers: [externalRow({ name: "old-name" })],
    publications: [publicationRow()],
  }) as unknown as Env;

  await assertRejects(
    () =>
      updateMcpServer(env.DB, "space_1", "srv_1", {
        name: "shared-mcp",
      }),
    Error,
    'MCP server "shared-mcp" already exists as a publication in this space',
  );
});

test("listMcpServers keeps publication and external MCP rows visible", async () => {
  const servers = await listMcpServers(
    (
      makeMcpEnv({
        mcpServers: [externalRow()],
        publications: [publicationRow()],
      }) as Env
    ).DB,
    "space_1",
  );

  assertEquals(servers.length, 2);
  assertEquals(
    servers.map((server) => [server.id, server.name, server.sourceType]),
    [
      ["publication:pub_1", "shared-mcp", "publication"],
      ["srv_1", "shared-mcp", "external"],
    ],
  );
});

test("listMcpServers marks bearer-auth MCP publications", async () => {
  const servers = await listMcpServers(
    (
      makeMcpEnv({
        mcpServers: [],
        publications: [
          publicationRow({
            specJson: JSON.stringify({
              name: "shared-mcp",
              publisher: "web",
              type: "protocol.mcp.server",
              outputs: { url: { kind: "url", routeRef: "mcp" } },
              auth: { bearer: { secretRef: "MCP_TOKEN" } },
            }),
          }),
        ],
      }) as Env
    ).DB,
    "space_1",
  );

  assertEquals(servers.length, 1);
  assertEquals(servers[0]?.id, "publication:pub_1");
  assertEquals(servers[0]?.authMode, "bearer_token");
});

test("listMcpServers marks v1 bearer-auth MCP publications", async () => {
  const servers = await listMcpServers(
    (
      makeMcpEnv({
        mcpServers: [],
        publications: [
          publicationRow({
            specJson: JSON.stringify({
              name: "shared-mcp",
              publisher: "web",
              type: "protocol.mcp.server",
              outputs: { url: { kind: "url", routeRef: "mcp" } },
              auth: { kind: "bearer", secretRef: "MCP_TOKEN" },
            }),
          }),
        ],
      }) as Env
    ).DB,
    "space_1",
  );

  assertEquals(servers.length, 1);
  assertEquals(servers[0]?.id, "publication:pub_1");
  assertEquals(servers[0]?.authMode, "bearer_token");
});

test("resolvePublicationMcpServerAccessToken rejects dangling bearer-auth publications", async () => {
  const env = makeMcpEnv({
    mcpServers: [],
    publications: [
      publicationRow({
        ownerServiceId: null,
        specJson: JSON.stringify({
          name: "shared-mcp",
          publisher: "web",
          type: "protocol.mcp.server",
          outputs: { url: { kind: "url", routeRef: "mcp" } },
          auth: { bearer: { secretRef: "MCP_TOKEN" } },
        }),
      }),
    ],
  }) as Env;

  await assertRejects(
    () =>
      resolvePublicationMcpServerAccessToken(env.DB, env, {
        spaceId: "space_1",
        serverId: "publication:pub_1",
      }),
    Error,
    "declares bearer auth secretRef but has no owner service",
  );
});

test("loadMcpTools keeps same-name publication and external servers distinct", async () => {
  const sdkTool = {
    name: "ping",
    description: "Ping",
    inputSchema: { type: "object" as const, properties: {} },
  };
  const schemaHash = await fingerprintMcpTool(sdkTool);
  const matchingPolicy = {
    accountId: "space_1",
    serverId: "srv_1",
    toolName: "ping",
    schemaHash,
    enabled: true,
    firstSeenAt: "2026-07-11T00:00:00.000Z",
    lastSeenAt: "2026-07-11T00:00:00.000Z",
    reviewedAt: "2026-07-11T00:00:00.000Z",
  };
  const connectStub = stub(
    McpClient.prototype as any,
    "connect",
    async () => {},
  );
  const listToolsStub = stub(
    McpClient.prototype as any,
    "listTools",
    async () => [
      {
        sdkTool,
        definition: {
          name: "ping",
          description: "Ping",
          category: "mcp",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
  );

  try {
    const result = await loadMcpTools(
      (
        makeMcpEnv({
          mcpServers: [externalRow()],
          mcpToolPolicies: [matchingPolicy],
          publications: [publicationRow()],
        }) as Env
      ).DB,
      "space_1",
      {
        DB: makeDb({
          mcpServers: [externalRow()],
          mcpToolPolicies: [matchingPolicy],
          publications: [publicationRow()],
        }),
        ENCRYPTION_KEY: "test-key",
      } as unknown as Env,
      new Set<string>(),
    );

    assertEquals(result.failedServers, []);
    assertEquals(result.tools.size, 2);
    const keys = Array.from(result.tools.keys());
    assertEquals(keys.includes("ping"), true);
    assertEquals(
      keys.some((key) => key !== "ping"),
      true,
    );
    const publicationTool = result.tools.get("ping")?.definition;
    const externalTool = result.tools.get(
      keys.find((key) => key !== "ping")!,
    )?.definition;
    assertEquals(publicationTool?.namespace, "mcp");
    assertEquals(publicationTool?.family, "mcp.shared-mcp");
    assertEquals(publicationTool?.risk_level, "low");
    assertEquals(publicationTool?.side_effects, true);
    assertEquals(externalTool?.namespace, "mcp");
    assertEquals(externalTool?.family, "mcp.shared-mcp");
    assertEquals(externalTool?.risk_level, "medium");
    assertEquals(externalTool?.side_effects, true);
  } finally {
    connectStub.restore();
    listToolsStub.restore();
  }
});

test("mcpRemoveServerHandler removes external servers by id only", async () => {
  const db = makeDb({
    mcpServers: [externalRow()],
    publications: [],
  });
  const context = {
    db,
    env: {
      DB: db,
      ENCRYPTION_KEY: "test-key",
    },
    spaceId: "space_1",
  } as any;

  const byId = JSON.parse(
    await mcpRemoveServerHandler(
      { id: "srv_1", name: "ignored-name" },
      context,
    ),
  ) as { status: string; name: string; message: string };
  assertEquals(byId.status, "removed");
  assertEquals(byId.name, "shared-mcp");
  assertStringIncludes(byId.message, "shared-mcp");

  await assertRejects(
    () => mcpRemoveServerHandler({ name: "shared-mcp" }, context),
    Error,
    "id is required",
  );
});
