import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import {
  getRuntimeInterfaceProtocolAdapter,
  listRuntimeInterfaceProtocolAdapters,
} from "../runtime-interface-profiles.ts";

test("runtime Interface registry dispatches mcp.server to the executable MCP adapter", () => {
  assertEquals(getRuntimeInterfaceProtocolAdapter("mcp.server"), {
    type: "mcp.server",
    version: "2025-11-25",
    mode: "executable",
    adapter: "mcp",
  });
});

test("runtime Interface registry marks OpenAPI and S3 protocols discovery-only", () => {
  assertEquals(
    listRuntimeInterfaceProtocolAdapters()
      .filter((adapter) => adapter.mode === "discovery-only")
      .map((adapter) => adapter.type),
    ["http.openapi", "storage.s3"],
  );
});

test("runtime Interface registry keeps unknown protocols metadata-only", () => {
  assertEquals(getRuntimeInterfaceProtocolAdapter("vendor.private.v1"), {
    type: "vendor.private.v1",
    mode: "metadata-only",
    adapter: null,
  });
});
