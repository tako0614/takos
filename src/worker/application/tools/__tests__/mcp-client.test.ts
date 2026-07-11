import { expect, test } from "bun:test";
import { convertMcpSchema, McpClient } from "../mcp-client.ts";
import {
  MAX_TOOL_ERROR_SIZE,
  MAX_TOOL_OUTPUT_SIZE,
} from "../../../shared/config/limits.ts";

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

test("convertMcpSchema preserves MCP behavior annotations", () => {
  const definition = convertMcpSchema({
    name: "web_search",
    description: "Search the web",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  });

  expect(definition.annotations).toEqual({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
});

test("MCP connection does not fall back to the retired SSE transport", async () => {
  const requestedUrls: string[] = [];
  const requestedHeaders: Headers[] = [];
  const egress = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrls.push(String(input));
      requestedHeaders.push(new Headers(init?.headers));
      return new Response("streamable transport unavailable", { status: 503 });
    },
  };
  const client = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
    egress,
    { spaceId: "space_1", runId: "run_1", mode: "mcp-tool" },
  );

  await expect(client.connect()).rejects.toThrow();
  expect(requestedUrls.length).toBeGreaterThan(0);
  expect(
    requestedUrls.every((url) => new URL(url).pathname === "/mcp"),
  ).toBeTrue();
  expect(
    requestedHeaders.every(
      (headers) =>
        headers.get("X-Takos-Space-Id") === "space_1" &&
        headers.get("X-Takos-Run-Id") === "run_1" &&
        headers.get("X-Takos-Egress-Mode") === "mcp-tool",
    ),
  ).toBeTrue();
});

test("MCP direct network fallback is disabled unless development opts in", async () => {
  const client = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
  );
  await expect(client.connect()).rejects.toThrow(
    "safe egress binding is unavailable",
  );
});

test("MCP transport rejects a declared oversized HTTP response before SDK parsing", async () => {
  const client = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
    {
      fetch: async () =>
        new Response("oversized", {
          status: 200,
          headers: { "content-length": String(6 * 1024 * 1024) },
        }),
    },
  );
  await expect(client.connect()).rejects.toThrow();
});

test("MCP tool results preserve structured content", async () => {
  const client = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
  );
  client.setClientForTest({
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({
      content: [{ type: "text", text: "summary" }],
      structuredContent: { count: 2, items: ["a", "b"] },
    }),
    close: async () => undefined,
  });

  await expect(client.callTool("lookup", {})).resolves.toBe(
    'summary\n{"count":2,"items":["a","b"]}',
  );
});

test("MCP tools/list follows bounded pagination", async () => {
  const client = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
  );
  const cursors: Array<string | undefined> = [];
  client.setClientForTest({
    listTools: async (params) => {
      cursors.push(params?.cursor);
      return params?.cursor === "page-2"
        ? {
            tools: [
              { name: "second", inputSchema: { type: "object" as const } },
            ],
          }
        : {
            tools: [
              { name: "first", inputSchema: { type: "object" as const } },
            ],
            nextCursor: "page-2",
          };
    },
    callTool: async () => ({ content: [] }),
    close: async () => undefined,
  });

  const tools = await client.listTools();
  expect(cursors).toEqual([undefined, "page-2"]);
  expect(tools.map(({ definition }) => definition.name)).toEqual([
    "first",
    "second",
  ]);
});

test("MCP tools/list rejects an oversized individual schema snapshot", async () => {
  const client = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
  );
  client.setClientForTest({
    listTools: async () => ({
      tools: [
        {
          name: "oversized",
          description: "x".repeat(129 * 1024),
          inputSchema: { type: "object" as const },
        },
      ],
    }),
    callTool: async () => ({ content: [] }),
    close: async () => undefined,
  });

  await expect(client.listTools()).rejects.toThrow("tool snapshot larger than");
});

test("MCP tools/list rejects an oversized aggregate server catalog", async () => {
  const client = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
  );
  client.setClientForTest({
    listTools: async () => ({
      tools: Array.from({ length: 36 }, (_, index) => ({
        name: `large_${index}`,
        description: "x".repeat(120 * 1024),
        inputSchema: { type: "object" as const },
      })),
    }),
    callTool: async () => ({ content: [] }),
    close: async () => undefined,
  });

  await expect(client.listTools()).rejects.toThrow("tool catalog exceeds");
});

test("MCP error results enter the tool error path", async () => {
  const client = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
  );
  client.setClientForTest({
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({
      content: [{ type: "text", text: "permission denied" }],
      isError: true,
    }),
    close: async () => undefined,
  });

  await expect(client.callTool("write", {})).rejects.toThrow(
    "MCP tool write reported an error after dispatch: permission denied",
  );
});

test("MCP success and error text are bounded before leaving the client", async () => {
  const success = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
  );
  success.setClientForTest({
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({
      content: [{ type: "text", text: "あ".repeat(MAX_TOOL_OUTPUT_SIZE) }],
    }),
    close: async () => undefined,
  });
  const output = await success.callTool("read", {});
  expect(utf8Bytes(output)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_SIZE);
  expect(output).toContain("MCP OUTPUT TRUNCATED");
  expect(output).not.toContain("�");

  const failure = new McpClient(
    "https://connector.example/mcp",
    null,
    "example",
  );
  failure.setClientForTest({
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({
      content: [{ type: "text", text: "x".repeat(MAX_TOOL_ERROR_SIZE * 2) }],
      isError: true,
    }),
    close: async () => undefined,
  });
  const error = await failure.callTool("write", {}).catch((value) => value);
  expect(error).toBeInstanceOf(Error);
  expect(utf8Bytes((error as Error).message)).toBeLessThanOrEqual(
    MAX_TOOL_ERROR_SIZE + 128,
  );
  expect((error as Error).message).toContain("MCP ERROR TRUNCATED");
});
