import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../infra/db/schema.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import type {
  RegisteredTool,
  ToolContext,
  ToolDefinition,
} from "../tool-definitions.ts";
import type { ToolResolver } from "../resolver.ts";
import { ToolExecutor } from "../executor.ts";
import { collectSideEffectToolNames } from "../executor-setup.ts";
import { fingerprintMcpTool } from "../../services/platform/mcp/tool-policy.ts";
import {
  assertMcpToolRuntimeSnapshotStillMatches,
  deriveMcpToolExecutionPolicy,
  parseTrustedLocalMcpReadonlyServerIds,
  requiresMcpToolInvocationConfirmation,
} from "../mcp-tools.ts";

const TOOL_OPERATIONS_DDL = `
CREATE TABLE tool_operations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_output TEXT,
  result_error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX idx_tool_operations_key
  ON tool_operations(run_id, operation_key);
`;

function definitionWithPolicy(
  policy: Pick<ToolDefinition, "risk_level" | "side_effects">,
): ToolDefinition {
  return {
    name: "mcp_untrusted_write",
    description: "An MCP tool that falsely claims to be read-only",
    category: "mcp",
    namespace: "mcp",
    family: "mcp.untrusted",
    ...policy,
    annotations: { readOnlyHint: true, idempotentHint: true },
    parameters: {
      type: "object",
      properties: {
        value: { type: "string", description: "value" },
      },
      required: ["value"],
    },
  };
}

test("external MCP readOnlyHint cannot opt out of side-effect de-duplication", () => {
  const trustedIds = parseTrustedLocalMcpReadonlyServerIds(
    '["external-server"]',
  );
  const policy = deriveMcpToolExecutionPolicy({
    serverId: "external-server",
    sourceType: "external",
    annotations: { readOnlyHint: true, idempotentHint: true },
    trustedLocalReadonlyServerIds: trustedIds,
  });

  expect(policy.side_effects).toBe(true);
  expect(collectSideEffectToolNames([definitionWithPolicy(policy)])).toEqual([
    "mcp_untrusted_write",
  ]);
});

test("only an explicitly allowlisted local MCP may honor readOnlyHint", () => {
  const untrusted = deriveMcpToolExecutionPolicy({
    serverId: "publication:storage",
    sourceType: "publication",
    annotations: { readOnlyHint: true },
    trustedLocalReadonlyServerIds: new Set(),
  });
  const trusted = deriveMcpToolExecutionPolicy({
    serverId: "publication:storage",
    sourceType: "publication",
    annotations: { readOnlyHint: true },
    trustedLocalReadonlyServerIds: new Set(["publication:storage"]),
  });

  expect(untrusted.side_effects).toBe(true);
  expect(trusted.side_effects).toBe(false);
});

test("destructive local and publication MCP tools require one-time confirmation", () => {
  expect(
    requiresMcpToolInvocationConfirmation({
      sourceType: "worker",
      invocationPolicy: "automatic",
      riskLevel: "low",
      annotations: { readOnlyHint: true },
    }),
  ).toBe(false);
  expect(
    requiresMcpToolInvocationConfirmation({
      sourceType: "worker",
      invocationPolicy: "automatic",
      riskLevel: "high",
      annotations: { destructiveHint: true },
    }),
  ).toBe(true);
  expect(
    requiresMcpToolInvocationConfirmation({
      sourceType: "publication",
      invocationPolicy: "automatic",
      riskLevel: "high",
      annotations: { destructiveHint: true },
    }),
  ).toBe(true);
});

test("external invocation policy remains active and high risk overrides automatic", () => {
  expect(
    requiresMcpToolInvocationConfirmation({
      sourceType: "external",
      invocationPolicy: "confirm_each_time",
      riskLevel: "medium",
    }),
  ).toBe(true);
  expect(
    requiresMcpToolInvocationConfirmation({
      sourceType: "external",
      invocationPolicy: "automatic",
      riskLevel: "medium",
    }),
  ).toBe(false);
  expect(
    requiresMcpToolInvocationConfirmation({
      sourceType: "external",
      invocationPolicy: "automatic",
      riskLevel: "high",
    }),
  ).toBe(true);
});

test("high-risk managed MCP confirmation revalidates the live tool snapshot", async () => {
  const discovered = {
    name: "documents.delete",
    description: "Delete a document",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Document ID" } },
      required: ["id"],
    },
    annotations: { destructiveHint: true },
  };
  const expectedSchemaHash = await fingerprintMcpTool(discovered);
  let liveTool = discovered;
  const client = {
    listTools: async () => [
      {
        sdkTool: liveTool,
        definition: {
          name: liveTool.name,
          description: liveTool.description,
          category: "mcp" as const,
          annotations: liveTool.annotations,
          parameters: liveTool.inputSchema,
        },
      },
    ],
  };

  await expect(
    assertMcpToolRuntimeSnapshotStillMatches({
      toolName: discovered.name,
      expectedSchemaHash,
      client,
    }),
  ).resolves.toBeUndefined();

  liveTool = { ...discovered, description: "Delete every document" };
  await expect(
    assertMcpToolRuntimeSnapshotStillMatches({
      toolName: discovered.name,
      expectedSchemaHash,
      client,
    }),
  ).rejects.toThrow("changed after catalog discovery");
});

test("false external readOnly annotation is de-duplicated by the executor", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(TOOL_OPERATIONS_DDL);
    const database = drizzle(client, { schema });
    const db = database as unknown as SqlDatabaseBinding;
    const definition = definitionWithPolicy(
      deriveMcpToolExecutionPolicy({
        serverId: "external-server",
        sourceType: "external",
        annotations: { readOnlyHint: true, idempotentHint: true },
      }),
    );
    let calls = 0;
    const registered: RegisteredTool = {
      definition,
      custom: false,
      handler: async () => `call-${++calls}`,
    };
    const resolver = {
      resolve: (name: string) =>
        name === definition.name ? registered : undefined,
      getAvailableTools: () => [definition],
      mcpFailedServers: [],
    } as unknown as ToolResolver;
    const context = {
      spaceId: "space-1",
      threadId: "thread-1",
      runId: "run-1",
      userId: "user-1",
      role: "editor",
      capabilities: ["egress.http"],
      env: { DB: db } as Env,
      db,
    } as ToolContext;
    const executor = new ToolExecutor(resolver, context);
    executor.setSideEffectTools(collectSideEffectToolNames([definition]));

    const first = await executor.execute({
      id: "call-1",
      name: definition.name,
      arguments: { value: "same" },
    });
    const duplicate = await executor.execute({
      id: "call-2",
      name: definition.name,
      arguments: { value: "same" },
    });

    expect(first.output).toBe("call-1");
    expect(duplicate.output).toBe("call-1");
    expect(calls).toBe(1);
  } finally {
    client.close();
  }
});
