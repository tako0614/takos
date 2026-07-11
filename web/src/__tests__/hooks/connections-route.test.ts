import {
  deepStrictEqual as assertEquals,
  strictEqual,
} from "node:assert/strict";
import { test } from "bun:test";
import { buildPath, parseRoute } from "../../hooks/router-state.ts";

test("connections route - parses a workspace-scoped page", () => {
  assertEquals(parseRoute("/connections/workspace-1"), {
    view: "connections",
    spaceId: "workspace-1",
  });
});

test("connections route - parses a provider deep-link", () => {
  assertEquals(
    parseRoute(
      "/connections/new",
      "?server=https%3A%2F%2Fconnector.example%2Fmcp",
    ),
    {
      view: "connections",
      connectionServer: "https://connector.example/mcp",
    },
  );
  assertEquals(
    parseRoute(
      "/connections/workspace-1",
      "?server=https%3A%2F%2Fconnector.example%2Fmcp",
    ),
    {
      view: "connections",
      spaceId: "workspace-1",
      connectionServer: "https://connector.example/mcp",
    },
  );
});

test("connections route - builds workspace and provider paths", () => {
  strictEqual(
    buildPath({ view: "connections", spaceId: "workspace-1" }),
    "/connections/workspace-1",
  );
  strictEqual(
    buildPath({
      view: "connections",
      connectionServer: "https://connector.example/mcp",
    }),
    "/connections/new?server=https%3A%2F%2Fconnector.example%2Fmcp",
  );
  strictEqual(
    buildPath({
      view: "connections",
      spaceId: "workspace-1",
      connectionServer: "https://connector.example/mcp",
    }),
    "/connections/workspace-1?server=https%3A%2F%2Fconnector.example%2Fmcp",
  );
});
