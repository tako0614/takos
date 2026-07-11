import { expect, test } from "bun:test";
import { ToolExecutor, truncateToolOutput } from "../executor.ts";
import { MAX_TOOL_OUTPUT_SIZE } from "../../../shared/config/limits.ts";
import type { ToolResolver } from "../resolver.ts";
import type {
  RegisteredTool,
  ToolContext,
  ToolDefinition,
} from "../tool-definitions.ts";

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

test("tool output limit is enforced in UTF-8 bytes", () => {
  const source = "あ".repeat(MAX_TOOL_OUTPUT_SIZE);
  const result = truncateToolOutput(source);

  expect(result.truncation.wasTruncated).toBeTrue();
  expect(result.truncation.originalLength).toBe(utf8Bytes(source));
  expect(utf8Bytes(result.output)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_SIZE);
  expect(result.output).toContain("OUTPUT TRUNCATED");
  expect(result.output).not.toContain("�");
});

test("bounded ASCII output is unchanged", () => {
  const source = "x".repeat(MAX_TOOL_OUTPUT_SIZE);
  const result = truncateToolOutput(source);

  expect(result).toEqual({
    output: source,
    truncation: { wasTruncated: false },
  });
});

test("a truncated successful result does not become a tool error", async () => {
  const definition: ToolDefinition = {
    name: "large_read",
    description: "Return a large read-only result",
    category: "artifact",
    risk_level: "none",
    side_effects: false,
    parameters: { type: "object", properties: {} },
  };
  const registered: RegisteredTool = {
    definition,
    custom: false,
    handler: async () => "z".repeat(MAX_TOOL_OUTPUT_SIZE + 1),
  };
  const resolver = {
    resolve: (name: string) =>
      name === definition.name ? registered : undefined,
  } as unknown as ToolResolver;
  const context = {
    spaceId: "space-1",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    role: "editor",
    capabilities: [],
    env: {},
    db: {},
  } as unknown as ToolContext;

  const result = await new ToolExecutor(resolver, context).execute({
    id: "call-1",
    name: definition.name,
    arguments: {},
  });

  expect(result.error).toBeUndefined();
  expect(result.output).toContain("OUTPUT TRUNCATED");
  expect(utf8Bytes(result.output)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_SIZE);
});

test("executor rejects arguments that violate the tool schema before the handler", async () => {
  let calls = 0;
  const definition = {
    name: "typed_write",
    description: "Write a bounded count",
    category: "artifact",
    risk_level: "low",
    side_effects: false,
    parameters: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1, maximum: 3 },
      },
      required: ["count"],
      additionalProperties: false,
    },
  } as unknown as ToolDefinition;
  const registered: RegisteredTool = {
    definition,
    custom: false,
    handler: async () => {
      calls++;
      return "ok";
    },
  };
  const resolver = {
    resolve: (name: string) =>
      name === definition.name ? registered : undefined,
  } as unknown as ToolResolver;
  const context = {
    spaceId: "space-1",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    role: "editor",
    capabilities: [],
    env: {},
    db: {},
  } as unknown as ToolContext;
  const executor = new ToolExecutor(resolver, context);

  const invalid = await executor.execute({
    id: "call-invalid",
    name: definition.name,
    arguments: { count: "three", extra: true },
  });
  expect(invalid.error).toContain("expected integer");
  expect(calls).toBe(0);

  const valid = await executor.execute({
    id: "call-valid",
    name: definition.name,
    arguments: { count: 2 },
  });
  expect(valid.error).toBeUndefined();
  expect(valid.output).toBe("ok");
  expect(calls).toBe(1);
});
