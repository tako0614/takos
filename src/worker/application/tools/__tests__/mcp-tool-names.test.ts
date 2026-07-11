import { expect, test } from "bun:test";
import { chooseMcpToolExposureName } from "../mcp-tools.ts";

const PROVIDER_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

test("valid unique MCP tool names remain readable", async () => {
  await expect(
    chooseMcpToolExposureName(new Set(), {
      serverName: "Search",
      serverId: "server-1",
      toolName: "web_search",
    }),
  ).resolves.toBe("web_search");
});

test("invalid and overlong MCP names map to stable provider-safe names", async () => {
  const input = {
    serverName: "Untrusted connector / 検索",
    serverId: "server-1",
    toolName: `search the web/${"x".repeat(100)}`,
  };
  const first = await chooseMcpToolExposureName(new Set(), input);
  const second = await chooseMcpToolExposureName(new Set(), input);

  expect(first).toBe(second);
  expect(first).toMatch(PROVIDER_NAME);
  expect(first.length).toBeLessThanOrEqual(64);
});

test("a collision is namespaced without shadowing the existing tool", async () => {
  const existing = new Set(["lookup"]);
  const exposed = await chooseMcpToolExposureName(existing, {
    serverName: "CRM",
    serverId: "server-2",
    toolName: "lookup",
  });

  expect(exposed).not.toBe("lookup");
  expect(exposed).toMatch(PROVIDER_NAME);
  expect(exposed.length).toBeLessThanOrEqual(64);
});
