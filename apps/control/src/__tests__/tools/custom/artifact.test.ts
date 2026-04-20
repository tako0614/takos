import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

import {
  ARTIFACT_TOOLS,
  CREATE_ARTIFACT,
  SEARCH,
} from "@/tools/custom/artifact";

Deno.test("artifact tools - definitions - CREATE_ARTIFACT requires type, title, content", () => {
  assertEquals(CREATE_ARTIFACT.name, "create_artifact");
  assertEquals(CREATE_ARTIFACT.category, "artifact");
  assertEquals(CREATE_ARTIFACT.parameters.required, [
    "type",
    "title",
    "content",
  ]);
});

Deno.test("artifact tools - definitions - SEARCH requires query", () => {
  assertEquals(SEARCH.name, "search");
  assertEquals(SEARCH.category, "artifact");
  assertEquals(SEARCH.parameters.required, ["query"]);
});

Deno.test("artifact tools - definitions - ARTIFACT_TOOLS exports both tools", () => {
  assertEquals(ARTIFACT_TOOLS.map((t) => t.name), [
    "create_artifact",
    "search",
  ]);
});

Deno.test("artifact tools - definitions - tool names are stable", () => {
  const names = ARTIFACT_TOOLS.map((t) => t.name).join(",");
  assertStringIncludes(names, "create_artifact");
  assertStringIncludes(names, "search");
});
