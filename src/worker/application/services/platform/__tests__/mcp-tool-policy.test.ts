import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/client.ts";
import {
  fingerprintMcpTool,
  listMcpToolPolicies,
  reconcileExternalMcpToolPolicies,
  snapshotMcpTools,
  updateExternalMcpToolPolicy,
} from "../mcp/tool-policy.ts";

async function freshDb(): Promise<{ client: Client; db: Database }> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'external',
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE mcp_tool_policies (
      account_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      invocation_policy TEXT NOT NULL DEFAULT 'confirm_each_time',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_mcp_tool_policies_account_server_tool
      ON mcp_tool_policies(account_id, server_id, tool_name);
    CREATE INDEX idx_mcp_tool_policies_account_server_enabled
      ON mcp_tool_policies(account_id, server_id, enabled);
  `);
  return {
    client,
    db: drizzle(client, { schema }) as unknown as Database,
  };
}

async function seedExternalServer(
  client: Client,
  accountId: string,
  serverId: string,
) {
  await client.execute({
    sql: "INSERT OR IGNORE INTO accounts (id) VALUES (?)",
    args: [accountId],
  });
  await client.execute({
    sql: "INSERT INTO mcp_servers (id, account_id, source_type) VALUES (?, ?, 'external')",
    args: [serverId, accountId],
  });
}

function tool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    name: "docs.read",
    description: "Read a document",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    ...overrides,
  };
}

test("external MCP tool policy defaults denied, preserves review, and re-denies changed shape", async () => {
  const { client, db } = await freshDb();
  try {
    await seedExternalServer(client, "space_a", "server_a");
    const [initial] = await snapshotMcpTools([tool()]);
    const first = await reconcileExternalMcpToolPolicies(db, {
      accountId: "space_a",
      serverId: "server_a",
      snapshots: [initial!],
      observedAt: "2026-07-11T01:00:00.000Z",
    });
    expect(first.get("docs.read")).toMatchObject({
      schemaHash: initial!.schemaHash,
      enabled: false,
      firstSeenAt: "2026-07-11T01:00:00.000Z",
      lastSeenAt: "2026-07-11T01:00:00.000Z",
      reviewedAt: null,
    });

    const enabled = await updateExternalMcpToolPolicy(db, {
      accountId: "space_a",
      serverId: "server_a",
      toolName: "docs.read",
      schemaHash: initial!.schemaHash,
      enabled: true,
      invocationPolicy: "confirm_each_time",
      reviewedAt: "2026-07-11T02:00:00.000Z",
    });
    expect(enabled).toMatchObject({
      enabled: true,
      reviewedAt: "2026-07-11T02:00:00.000Z",
    });

    const unchanged = await reconcileExternalMcpToolPolicies(db, {
      accountId: "space_a",
      serverId: "server_a",
      snapshots: [initial!],
      observedAt: "2026-07-11T03:00:00.000Z",
    });
    expect(unchanged.get("docs.read")).toMatchObject({
      enabled: true,
      schemaHash: initial!.schemaHash,
      firstSeenAt: "2026-07-11T01:00:00.000Z",
      lastSeenAt: "2026-07-11T03:00:00.000Z",
      reviewedAt: "2026-07-11T02:00:00.000Z",
    });

    const [changed] = await snapshotMcpTools([
      tool({
        description: "Read or export a document",
        annotations: { readOnlyHint: false, destructiveHint: true },
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            format: { type: "string", enum: ["text", "pdf"] },
          },
          required: ["id"],
        },
      }),
    ]);
    expect(changed!.schemaHash).not.toBe(initial!.schemaHash);
    const mutated = await reconcileExternalMcpToolPolicies(db, {
      accountId: "space_a",
      serverId: "server_a",
      snapshots: [changed!],
      observedAt: "2026-07-11T04:00:00.000Z",
    });
    expect(mutated.get("docs.read")).toMatchObject({
      enabled: false,
      schemaHash: changed!.schemaHash,
      firstSeenAt: "2026-07-11T01:00:00.000Z",
      lastSeenAt: "2026-07-11T04:00:00.000Z",
      reviewedAt: null,
    });
    expect(
      await updateExternalMcpToolPolicy(db, {
        accountId: "space_a",
        serverId: "server_a",
        toolName: "docs.read",
        schemaHash: initial!.schemaHash,
        enabled: true,
        invocationPolicy: "confirm_each_time",
      }),
    ).toBeNull();
  } finally {
    client.close();
  }
});

test("MCP tool fingerprint is stable across JSON object key order", async () => {
  const first = tool({
    inputSchema: {
      type: "object",
      properties: { beta: { type: "number" }, alpha: { type: "string" } },
    },
  });
  const second = tool({
    inputSchema: {
      properties: { alpha: { type: "string" }, beta: { type: "number" } },
      type: "object",
    },
  });
  expect(await fingerprintMcpTool(first)).toBe(
    await fingerprintMcpTool(second),
  );
});

test("MCP output schema and execution-contract changes require review", async () => {
  const initial = tool();
  const withOutput = tool({
    outputSchema: {
      type: "object",
      properties: { result: { type: "string" } },
    },
  });
  const withTaskExecution = tool({
    execution: { taskSupport: "required" },
  });

  const initialHash = await fingerprintMcpTool(initial);
  expect(await fingerprintMcpTool(withOutput)).not.toBe(initialHash);
  expect(await fingerprintMcpTool(withTaskExecution)).not.toBe(initialHash);
});

test("external MCP tool policy is isolated by Workspace", async () => {
  const { client, db } = await freshDb();
  try {
    await seedExternalServer(client, "space_a", "server_a");
    await client.execute({
      sql: "INSERT INTO accounts (id) VALUES (?)",
      args: ["space_b"],
    });
    const [snapshot] = await snapshotMcpTools([tool()]);
    await expect(
      reconcileExternalMcpToolPolicies(db, {
        accountId: "space_b",
        serverId: "server_a",
        snapshots: [snapshot!],
      }),
    ).rejects.toThrow("External MCP server");
    expect(await listMcpToolPolicies(db, "space_b", "server_a")).toEqual([]);

    await reconcileExternalMcpToolPolicies(db, {
      accountId: "space_a",
      serverId: "server_a",
      snapshots: [snapshot!],
    });
    await expect(
      updateExternalMcpToolPolicy(db, {
        accountId: "space_b",
        serverId: "server_a",
        toolName: "docs.read",
        schemaHash: snapshot!.schemaHash,
        enabled: true,
        invocationPolicy: "confirm_each_time",
      }),
    ).rejects.toThrow("External MCP server");
  } finally {
    client.close();
  }
});

test("deleting an external MCP server cascades its tool policy rows", async () => {
  const { client, db } = await freshDb();
  try {
    await seedExternalServer(client, "space_a", "server_a");
    const snapshots = await snapshotMcpTools([tool()]);
    await reconcileExternalMcpToolPolicies(db, {
      accountId: "space_a",
      serverId: "server_a",
      snapshots,
    });
    expect(await listMcpToolPolicies(db, "space_a", "server_a")).toHaveLength(
      1,
    );

    await client.execute({
      sql: "DELETE FROM mcp_servers WHERE id = ?",
      args: ["server_a"],
    });
    expect(await listMcpToolPolicies(db, "space_a", "server_a")).toEqual([]);
  } finally {
    client.close();
  }
});
