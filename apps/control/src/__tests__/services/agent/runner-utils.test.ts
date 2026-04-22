import { buildToolTelemetry } from "@/services/agent/runner-utils";

import { assertEquals } from "jsr:@std/assert";

Deno.test("buildToolTelemetry marks direct tools", () => {
  assertEquals(buildToolTelemetry("file_read", { path: "README.md" }), {
    tool_kind: "direct",
  });
});

Deno.test("buildToolTelemetry extracts toolbox action details", () => {
  assertEquals(
    buildToolTelemetry("toolbox", {
      action: "search",
      query: "slide manual",
    }),
    {
      tool_kind: "discovery",
      discovery_tool: "toolbox",
      toolbox_action: "search",
      toolbox_query: "slide manual",
    },
  );
});

Deno.test("buildToolTelemetry extracts capability search details", () => {
  assertEquals(
    buildToolTelemetry("capability_search", { query: "publish app" }),
    {
      tool_kind: "discovery",
      discovery_tool: "capability_search",
      discovery_action: "search",
      discovery_query: "publish app",
    },
  );
});
