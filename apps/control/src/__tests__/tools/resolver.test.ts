import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import { assert, assertEquals } from "jsr:@std/assert";

import { createToolResolver, ToolResolver } from "@/tools/resolver";
import { CUSTOM_TOOLS } from "@/tools/custom";

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
  let queryCount = 0;
  const db = {
    select: () => {
      queryCount++;
      if (shouldThrow) {
        throw new Error("db failed");
      }
      return {
        from: function (this: any) {
          return this;
        },
        where: function (this: any) {
          return this;
        },
        orderBy: function (this: any) {
          return this;
        },
        all: async () => (queryCount === 1 ? rows : []),
        get: async () => (queryCount === 1 ? rows[0] ?? null : null),
      };
    },
    insert: () => ({
      values: () => ({
        run: async () => undefined,
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => ({ meta: { changes: 0 } }),
      }),
    }),
    delete: () => ({
      where: async () => ({ meta: { changes: 0 } }),
    }),
  } as unknown as D1Database;

  return { db, getPrepareCount: () => queryCount };
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

Deno.test("ToolResolver - resolve - resolves a Takos-managed tool by name", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  const tool = resolver.resolve("file_read");
  assert(tool !== undefined);
  assertEquals(tool!.custom, true);
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

Deno.test("ToolResolver - exists - returns true for existing Takos-managed tools", async () => {
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

Deno.test("ToolResolver - isCustom - identifies Takos-managed tools", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  assertEquals(resolver.isCustom("file_read"), true);
  assertEquals(resolver.isCustom("nonexistent"), false);
});

Deno.test("ToolResolver - getAvailableTools - returns all Takos-managed tools when no MCP tools loaded", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test");
  await resolver.init();

  const tools = resolver.getAvailableTools();
  assertEquals(tools.length, CUSTOM_TOOLS.length);
});

Deno.test("ToolResolver - getAvailableTools - keeps Takos-managed tools when MCP exposure filters out all servers", async () => {
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
  assertEquals(tools.length, CUSTOM_TOOLS.length);
});

Deno.test("ToolResolver - disabledCustomTools - hides disabled Takos-managed tools from getAvailableTools", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test", undefined, {
    disabledCustomTools: ["file_read", "file_write"],
  });
  await resolver.init();

  const tools = resolver.getAvailableTools();
  assertEquals(tools.some((tool) => tool.name === "file_read"), false);
  assertEquals(tools.some((tool) => tool.name === "file_write"), false);
});

Deno.test("ToolResolver - disabledCustomTools - returns undefined when resolving disabled Takos-managed tools", async () => {
  const resolver = new ToolResolver({} as D1Database, "ws-test", undefined, {
    disabledCustomTools: ["file_read"],
  });
  await resolver.init();

  assertEquals(resolver.resolve("file_read"), undefined);
  assertEquals(resolver.exists("file_read"), false);
  assertEquals(resolver.isCustom("file_read"), false);
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

  assertEquals(getPrepareCount(), 2);
  assertEquals(resolver.getAvailableTools().length, CUSTOM_TOOLS.length);
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
