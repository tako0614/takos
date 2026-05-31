import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { buildPath, parseRoute } from "../../hooks/router-state.ts";
import { test } from "bun:test";


test("parseRoute - parses repo file references from query params", () => {
  assertEquals(
    parseRoute("/alice/demo", "?path=src/main.ts&line=42&ref=main"),
    {
      view: "repo",
      username: "alice",
      repoName: "demo",
      filePath: "src/main.ts",
      fileLine: 42,
      ref: "main",
    },
  );
});

test("buildPath - builds repo file references with query params", () => {
  assertEquals(
    buildPath({
      view: "repo",
      username: "alice",
      repoName: "demo",
      filePath: "src/main.ts",
      fileLine: 42,
      ref: "main",
    }),
    "/alice/demo?ref=main&path=src%2Fmain.ts&line=42",
  );
});

test("parseRoute - treats storage open links as file references", () => {
  assertEquals(
    parseRoute("/storage/ws-1/docs/README.md", "?open=1"),
    {
      view: "storage",
      spaceId: "ws-1",
      storagePath: "/docs",
      filePath: "/docs/README.md",
    },
  );
});

test("buildPath - builds storage file reference links", () => {
  assertEquals(
    buildPath({
      view: "storage",
      spaceId: "ws-1",
      storagePath: "/docs",
      filePath: "/docs/README.md",
    }),
    "/storage/ws-1/docs/README.md?open=1",
  );
});

test("buildPath - builds storage folder routes", () => {
  assertEquals(
    buildPath({
      view: "storage",
      spaceId: "ws-1",
      storagePath: "/docs",
    }),
    "/storage/ws-1/docs",
  );
});
