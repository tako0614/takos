import { BUILTIN_TOOLS } from "@/tools/builtin";
import { TOOL_NAMESPACE_MAP } from "@/tools/namespace-map";

import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("namespace-map - has an entry for every builtin tool", () => {
  const unmapped: string[] = [];
  for (const tool of BUILTIN_TOOLS) {
    if (!TOOL_NAMESPACE_MAP[tool.name]) {
      unmapped.push(tool.name);
    }
  }
  assertEquals(unmapped, []);
});
Deno.test("namespace-map - has no entries for non-existent tools", () => {
  const builtinNames = new Set(BUILTIN_TOOLS.map((t) => t.name));
  const extra: string[] = [];
  for (const name of Object.keys(TOOL_NAMESPACE_MAP)) {
    if (!builtinNames.has(name)) {
      extra.push(name);
    }
  }
  assertEquals(extra, []);
});
Deno.test("namespace-map - all entries have valid namespace and family", () => {
  for (const [_name, meta] of Object.entries(TOOL_NAMESPACE_MAP)) {
    assert(meta.namespace);
    assert(meta.family);
    assertEquals(
      ["none", "low", "medium", "high"].includes(meta.risk_level),
      true,
    );
    assertEquals(typeof meta.side_effects, "boolean");
  }
});
Deno.test("namespace-map - applies namespace metadata to BUILTIN_TOOLS", () => {
  const fileRead = BUILTIN_TOOLS.find((t) => t.name === "file_read");
  assert(fileRead !== undefined);
  assertEquals(fileRead!.namespace, "file");
  assertEquals(fileRead!.family, "file.ops");
  assertEquals(fileRead!.risk_level, "none");
  assertEquals(fileRead!.side_effects, false);
});
Deno.test("namespace-map - applies deploy metadata correctly", () => {
  const deployFrontend = BUILTIN_TOOLS.find((t) =>
    t.name === "deploy_frontend"
  );
  assert(deployFrontend !== undefined);
  assertEquals(deployFrontend!.namespace, "deploy");
  assertEquals(deployFrontend!.risk_level, "high");
  assertEquals(deployFrontend!.side_effects, true);
});
