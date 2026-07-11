import { expect, test } from "bun:test";
import { stub } from "@takos/test/mock";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../infra/db/schema.ts";
import {
  mcpServers,
  mcpToolPolicies,
  publications,
} from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import { fingerprintMcpTool } from "../../services/platform/mcp/tool-policy.ts";
import { McpClient } from "../mcp-client.ts";
import {
  assertExternalMcpToolExecutionStillApproved,
  loadMcpTools,
} from "../mcp-tools.ts";

function makeRows(rows: Array<Record<string, unknown>>) {
  return {
    where: () => ({
      orderBy: () => ({ all: () => Promise.resolve(rows) }),
      all: () => Promise.resolve(rows),
      get: () => Promise.resolve(rows[0] ?? null),
    }),
    orderBy: () => ({ all: () => Promise.resolve(rows) }),
    all: () => Promise.resolve(rows),
    get: () => Promise.resolve(rows[0] ?? null),
  };
}

function makeDb(policyRows: Array<Record<string, unknown>>) {
  const serverRows = [
    {
      id: "server_a",
      accountId: "space_a",
      name: "external-docs",
      url: "https://connector.example/mcp",
      sourceType: "external",
      authMode: "oauth_pkce",
      serviceId: null,
      bundleDeploymentId: null,
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthIssuerUrl: null,
      oauthTokenExpiresAt: null,
      enabled: true,
    },
  ];
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === mcpServers) return makeRows(serverRows);
        if (table === mcpToolPolicies) return makeRows(policyRows);
        if (table === publications) return makeRows([]);
        return makeRows([]);
      },
    }),
    insert: () => ({ values: () => undefined }),
    update: () => ({ set: () => ({ where: () => undefined }) }),
    delete: () => ({ where: () => undefined }),
  } as never;
}

test("loadMcpTools exposes external tools only for a matching enabled snapshot", async () => {
  const sdkTool = {
    name: "docs.read",
    description: "Read a document",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  };
  const schemaHash = await fingerprintMcpTool(sdkTool);
  const connectStub = stub(
    McpClient.prototype as never,
    "connect",
    async () => {},
  );
  const listToolsStub = stub(
    McpClient.prototype as never,
    "listTools",
    async () => [
      {
        sdkTool,
        definition: {
          name: sdkTool.name,
          description: sdkTool.description,
          category: "mcp" as const,
          annotations: sdkTool.annotations,
          parameters: sdkTool.inputSchema,
        },
      },
    ],
  );

  const policy = (overrides: Record<string, unknown> = {}) => ({
    accountId: "space_a",
    serverId: "server_a",
    toolName: sdkTool.name,
    schemaHash,
    enabled: true,
    invocationPolicy: "automatic",
    firstSeenAt: "2026-07-11T00:00:00.000Z",
    lastSeenAt: "2026-07-11T00:00:00.000Z",
    reviewedAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  });

  const load = async (policies: Array<Record<string, unknown>>) => {
    const db = makeDb(policies);
    return await loadMcpTools(
      db,
      "space_a",
      { DB: db, ENCRYPTION_KEY: "test-key" } as unknown as Env,
      new Set(),
    );
  };

  try {
    expect((await load([])).tools.size).toBe(0);
    expect((await load([policy({ enabled: false })])).tools.size).toBe(0);
    expect(
      (await load([policy({ schemaHash: "0".repeat(64) })])).tools.size,
    ).toBe(0);

    const allowed = await load([policy()]);
    expect(allowed.failedServers).toEqual([]);
    expect(allowed.tools.size).toBe(1);
    const exposed = [...allowed.tools.values()][0]?.definition;
    expect(exposed?.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(exposed?.name).not.toBe("docs.read");
    expect(exposed).toMatchObject({
      annotations: sdkTool.annotations,
      risk_level: "medium",
      side_effects: true,
    });
  } finally {
    connectStub.restore();
    listToolsStub.restore();
  }
});

test("external MCP execution rechecks the live snapshot, connection, Workspace, and policy", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      url TEXT NOT NULL,
      source_type TEXT NOT NULL,
      enabled INTEGER NOT NULL
    );
    CREATE TABLE mcp_tool_policies (
      account_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL
    );
  `);
  const db = drizzle(client, { schema }) as unknown as Database;
  const approvedTool = {
    name: "docs.read",
    description: "Read a document",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  };
  const approvedSchemaHash = await fingerprintMcpTool(approvedTool);
  await client.execute({
    sql: "INSERT INTO mcp_servers (id, account_id, url, source_type, enabled) VALUES (?, ?, ?, 'external', 1)",
    args: ["server_a", "space_a", "https://connector.example/mcp"],
  });
  await client.execute({
    sql: "INSERT INTO mcp_tool_policies (account_id, server_id, tool_name, schema_hash, enabled) VALUES (?, ?, ?, ?, 1)",
    args: ["space_a", "server_a", approvedTool.name, approvedSchemaHash],
  });

  let currentTool = approvedTool;
  const toolLister = {
    listTools: async () => [
      {
        sdkTool: currentTool,
        definition: {
          name: currentTool.name,
          description: currentTool.description,
          category: "mcp" as const,
          annotations: currentTool.annotations,
          parameters: currentTool.inputSchema,
        },
      },
    ],
  } as Pick<McpClient, "listTools">;
  const assertApproved = (
    overrides: Partial<{
      spaceId: string;
      serverUrl: string;
    }> = {},
  ) =>
    assertExternalMcpToolExecutionStillApproved(db, {
      spaceId: overrides.spaceId ?? "space_a",
      serverId: "server_a",
      serverUrl: overrides.serverUrl ?? "https://connector.example/mcp",
      toolName: approvedTool.name,
      approvedSchemaHash,
      client: toolLister,
    });

  try {
    await expect(assertApproved()).resolves.toBeUndefined();

    await client.execute(
      "UPDATE mcp_tool_policies SET enabled = 0 WHERE server_id = 'server_a'",
    );
    await expect(assertApproved()).rejects.toThrow("no longer enabled");

    await client.execute(
      "UPDATE mcp_tool_policies SET enabled = 1 WHERE server_id = 'server_a'",
    );
    currentTool = {
      ...approvedTool,
      description: "Read or delete a document",
      annotations: {
        ...approvedTool.annotations,
        destructiveHint: true,
      },
    };
    await expect(assertApproved()).rejects.toThrow("changed after approval");

    currentTool = approvedTool;
    await client.execute(
      "UPDATE mcp_servers SET enabled = 0 WHERE id = 'server_a'",
    );
    await expect(assertApproved()).rejects.toThrow("no longer enabled");

    await client.execute(
      "UPDATE mcp_servers SET enabled = 1 WHERE id = 'server_a'",
    );
    await expect(assertApproved({ spaceId: "space_b" })).rejects.toThrow(
      "no longer enabled",
    );
    await expect(
      assertApproved({ serverUrl: "https://other.example/mcp" }),
    ).rejects.toThrow("no longer enabled");
  } finally {
    client.close();
  }
});
