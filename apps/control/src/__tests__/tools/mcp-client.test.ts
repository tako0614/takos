import { assertEquals, assertRejects } from "jsr:@std/assert";

import {
  convertMcpSchema,
  McpClient,
  type McpTool,
} from "../../../../../packages/control/src/application/tools/mcp-client.ts";

Deno.test("convertMcpSchema - converts an MCP tool to a ToolDefinition", () => {
  const tool: McpTool = {
    name: "get_weather",
    description: "Fetch weather data",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name" },
      },
      required: ["location"],
    },
  };

  const def = convertMcpSchema(tool);
  assertEquals(def.name, "get_weather");
  assertEquals(def.description, "Fetch weather data");
  assertEquals(def.category, "mcp");
  assertEquals(def.parameters.type, "object");
});

Deno.test("convertMcpSchema - defaults description and schema shape when missing", () => {
  const def = convertMcpSchema({
    name: "no_desc",
    inputSchema: { type: "object" },
  } as McpTool);

  assertEquals(def.description, "");
  assertEquals(def.parameters.type, "object");
});

Deno.test("McpClient - listTools and callTool work with an injected connected client", async () => {
  const client = new McpClient("https://example.com/mcp", "tok", "server");
  const fakeClient = {
    listTools: async () => ({
      tools: [
        {
          name: "do_thing",
          description: "Does a thing",
          inputSchema: {
            type: "object",
            properties: { x: { type: "string" } },
          },
        },
      ],
    }),
    callTool: async () => ({
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
    }),
    close: async () => undefined,
  };

  (client as unknown as { client: typeof fakeClient | null }).client =
    fakeClient;

  const tools = await client.listTools();
  assertEquals(tools.length, 1);
  assertEquals(tools[0].definition.name, "do_thing");
  assertEquals(tools[0].definition.category, "mcp");

  const result = await client.callTool("do_thing", { x: "1" });
  assertEquals(result, "hello\nworld");
});

Deno.test("McpClient - close clears the injected client", async () => {
  let closeCalls = 0;
  const client = new McpClient("https://example.com/mcp", null, "server");
  (client as unknown as { client: unknown }).client = {
    close: async () => {
      closeCalls += 1;
    },
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [] }),
  };

  await client.close();
  assertEquals(closeCalls, 1);
  await assertRejects(() => client.listTools(), "not connected");
});

Deno.test("McpClient - callTool throws when not connected", async () => {
  const client = new McpClient("https://example.com/mcp", null, "server");
  await assertRejects(() => client.callTool("tool", {}), "not connected");
});
