import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import { assert, assertEquals } from "jsr:@std/assert";

import { createToolResolver, ToolResolver } from "@/tools/resolver";
import { BUILTIN_TOOLS } from "@/tools/builtin";

type McpRow = {
  id: string;
  name: string;
  url: string;
  sourceType: string;
  authMode: string;
  serviceId: string | null;
  bundleDeploymentId: string | null;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthIssuerUrl: string | null;
  oauthTokenExpiresAt: string | Date | null;
};

function createFakeD1(rows: McpRow[], shouldThrow = false) {
  let prepareCount = 0;
  const db = {
    prepare() {
      prepareCount++;
      if (shouldThrow) {
        throw new Error("db failed");
      }

      return {
        bind() {
          return {
            all: async () => ({ results: rows }),
            first: async () => rows[0] ?? null,
            run: async () => ({
              success: true,
              meta: { changes: 0, last_row_id: 0, duration: 0 },
            }),
            raw: async () => rows.map((row) => Object.values(row)),
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, getPrepareCount: () => prepareCount };
}

const EXTERNAL_SERVER: McpRow = {
  id: "external-1",
  name: "external",
  url: "https://external.example.com/mcp",
  sourceType: "external",
  authMode: "oauth",
  serviceId: null,
  bundleDeploymentId: null,
  oauthAccessToken: "encrypted-token",
  oauthRefreshToken: "encrypted-refresh",
  oauthIssuerUrl: "https://issuer.example.com",
  oauthTokenExpiresAt: null,
};

Deno.test("ToolResolver - resolve - resolves a builtin tool by name", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  const tool = resolver.resolve("file_read");
  assert(tool !== undefined);
  assertEquals(tool!.builtin, true);
  assertEquals(tool!.definition.name, "file_read");
  assertEquals(typeof tool!.handler, "function");
});

Deno.test("ToolResolver - resolve - returns undefined for unknown tools", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  const tool = resolver.resolve("nonexistent_tool");
  assertEquals(tool, undefined);
});

Deno.test("ToolResolver - resolve - returns undefined for invalid tool names", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  assertEquals(resolver.resolve(""), undefined);
  assertEquals(resolver.resolve(null as unknown as string), undefined);
  assertEquals(resolver.resolve(undefined as unknown as string), undefined);
});

Deno.test("ToolResolver - exists - returns true for existing builtin tools", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  assertEquals(resolver.exists("file_read"), true);
  assertEquals(resolver.exists("container_start"), true);
});

Deno.test("ToolResolver - exists - returns false for nonexistent tools", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  assertEquals(resolver.exists("does_not_exist"), false);
});

Deno.test("ToolResolver - isBuiltin - identifies builtin tools", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  assertEquals(resolver.isBuiltin("file_read"), true);
  assertEquals(resolver.isBuiltin("nonexistent"), false);
});

Deno.test("ToolResolver - getAvailableTools - returns all builtin tools when no MCP tools loaded", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  const tools = resolver.getAvailableTools();
  assertEquals(tools.length, BUILTIN_TOOLS.length);
});

Deno.test("ToolResolver - getAvailableTools - keeps builtin tools when MCP exposure filters out all servers", async () => {
  const { db } = createFakeD1([EXTERNAL_SERVER]);
  const env = {} as Env;
  const resolver = new ToolResolver(db, "ws-test", env, {
    mcpExposureContext: {
      role: "viewer",
      capabilities: ["repo.read", "storage.read"],
    },
  });
  await resolver.init();

  const tools = resolver.getAvailableTools();
  assertEquals(tools.length, BUILTIN_TOOLS.length);
});

Deno.test("ToolResolver - disabledBuiltinTools - hides disabled builtin tools from getAvailableTools", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test", undefined, {
    disabledBuiltinTools: ["file_read", "file_write"],
  });
  await resolver.init();

  const tools = resolver.getAvailableTools();
  assertEquals(tools.some((tool) => tool.name === "file_read"), false);
  assertEquals(tools.some((tool) => tool.name === "file_write"), false);
});

Deno.test("ToolResolver - disabledBuiltinTools - returns undefined when resolving disabled builtin tools", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test", undefined, {
    disabledBuiltinTools: ["file_read"],
  });
  await resolver.init();

  assertEquals(resolver.resolve("file_read"), undefined);
  assertEquals(resolver.exists("file_read"), false);
  assertEquals(resolver.isBuiltin("file_read"), false);
});

Deno.test("ToolResolver - init idempotency - does not reinitialize on second call", async () => {
  const { db, getPrepareCount } = createFakeD1([EXTERNAL_SERVER]);
  const env = {} as Env;
  const resolver = new ToolResolver(db, "ws-test", env, {
    mcpExposureContext: {
      role: "viewer",
      capabilities: ["repo.read", "storage.read"],
    },
  });
  await resolver.init();
  await resolver.init();

  assertEquals(getPrepareCount(), 1);
  assertEquals(resolver.getAvailableTools().length, BUILTIN_TOOLS.length);
});

Deno.test("ToolResolver - mcpFailedServers - exposes failed MCP server names", async () => {
  const { db } = createFakeD1([], true);
  const env = {} as Env;
  const resolver = new ToolResolver(db, "ws-test", env);
  await resolver.init();

  assertEquals(resolver.mcpFailedServers, ["(all — DB query failed)"]);
});

Deno.test("ToolResolver - getToolNamesByCategory - returns tool names for a given category", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  const fileTools = resolver.getToolNamesByCategory("file");
  assert(fileTools.length > 0);
  assert(fileTools.includes("file_read"));
});

Deno.test("ToolResolver - createToolResolver factory - returns an initialized ToolResolver", async () => {
  const resolver = await createToolResolver({} as D1Database, "ws-test");
  assert(resolver instanceof ToolResolver);
  assertEquals(resolver.exists("file_read"), true);
});
