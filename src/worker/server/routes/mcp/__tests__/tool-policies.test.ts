import { expect, test } from "bun:test";

import type { Env } from "../../../../shared/types/index.ts";
import { createApiRouter } from "../../api.ts";
import {
  selectObservedToolSnapshot,
  serializeMcpToolPolicyView,
} from "../tool-policies.ts";

const snapshot = {
  tool: {
    name: "docs.write",
    description: "Write a document",
    inputSchema: {
      type: "object" as const,
      properties: { body: { type: "string" } },
      required: ["body"],
    },
    annotations: { destructiveHint: true, idempotentHint: false },
  },
  schemaHash: "a".repeat(64),
};

test("MCP tool policy DTO keeps schema, annotations, review state, and risk fields", () => {
  const external = serializeMcpToolPolicyView(
    {} as Env,
    { id: "server_a", sourceType: "external" } as never,
    snapshot,
    undefined,
  );
  expect(external).toMatchObject({
    name: "docs.write",
    inputSchema: snapshot.tool.inputSchema,
    annotations: snapshot.tool.annotations,
    enabled: false,
    review_required: true,
    schema_hash: "a".repeat(64),
    policy_read_only: false,
    supported: true,
    unsupported_reason: null,
    risk_level: "high",
    side_effects: true,
  });

  const managed = serializeMcpToolPolicyView(
    {} as Env,
    { id: "publication:docs", sourceType: "publication" } as never,
    snapshot,
    undefined,
  );
  expect(managed).toMatchObject({
    enabled: true,
    review_required: false,
    policy_read_only: true,
  });

  const taskRequired = serializeMcpToolPolicyView(
    {} as Env,
    { id: "server_a", sourceType: "external" } as never,
    {
      ...snapshot,
      tool: {
        ...snapshot.tool,
        execution: { taskSupport: "required" as const },
      },
    },
    {
      enabled: true,
      reviewedAt: "2026-07-11T00:00:00.000Z",
    } as never,
  );
  expect(taskRequired).toMatchObject({
    execution: { taskSupport: "required" },
    supported: false,
    unsupported_reason: "task_execution_required",
    enabled: false,
    review_required: false,
  });
});

test("MCP tool list and exposure update routes are mounted", () => {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const router = createApiRouter({
    requireAuth: noop as never,
    optionalAuth: noop as never,
  });
  const signatures = router.routes.map(
    (route) => `${route.method} ${route.path}`,
  );

  expect(signatures).toContain("GET /mcp/servers/:id/tools");
  expect(signatures).toContain("PATCH /mcp/servers/:id/tools/:toolName");
  expect(signatures).toContain("GET /mcp/tool-confirmations");
  expect(signatures).toContain("POST /mcp/tool-confirmations/:id/decision");
});

test("MCP tool exposure updates reject a stale UI-observed snapshot hash", () => {
  expect(
    selectObservedToolSnapshot(
      [snapshot],
      snapshot.tool.name,
      snapshot.schemaHash,
    ),
  ).toBe(snapshot);
  expect(() =>
    selectObservedToolSnapshot([snapshot], snapshot.tool.name, "b".repeat(64)),
  ).toThrow("changed after it was reviewed");
});
