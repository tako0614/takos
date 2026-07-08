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
import { mcpServers, publications } from "../../../../infra/db/index.ts";
import type { Env } from "../../../../shared/types/index.ts";

type DbTableRows = {
  mcpServers: Array<Record<string, unknown>>;
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
        if (table === publications) return makeRowTable(rows.publications);
        return makeRowTable([]);
      },
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => undefined,
      }),
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
        name: "shared-mcp",
        url: "https://external.example/mcp",
      }),
    Error,
    'MCP server "shared-mcp" already exists as a publication in this space',
  );
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
        sdkTool: {
          name: "ping",
          description: "Ping",
          inputSchema: { type: "object", properties: {} },
        },
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
          publications: [publicationRow()],
        }) as Env
      ).DB,
      "space_1",
      {
        DB: makeDb({
          mcpServers: [externalRow()],
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
    const externalTool = result.tools.get("shared-mcp__ping")?.definition;
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
