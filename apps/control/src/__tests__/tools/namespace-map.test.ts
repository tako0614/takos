import { CUSTOM_TOOLS } from "@/tools/custom";
import { TOOL_NAMESPACE_MAP } from "@/tools/namespace-map";

import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("namespace-map - has an entry for every Takos-managed tool", () => {
  const unmapped: string[] = [];
  for (const tool of CUSTOM_TOOLS) {
    if (!TOOL_NAMESPACE_MAP[tool.name]) {
      unmapped.push(tool.name);
    }
  }
  assertEquals(unmapped, []);
});
Deno.test("namespace-map - has no entries for non-existent tools", () => {
  const customNames = new Set(CUSTOM_TOOLS.map((t) => t.name));
  const extra: string[] = [];
  for (const name of Object.keys(TOOL_NAMESPACE_MAP)) {
    if (!customNames.has(name)) {
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
Deno.test("namespace-map - applies namespace metadata to CUSTOM_TOOLS", () => {
  const fileRead = CUSTOM_TOOLS.find((t) => t.name === "file_read");
  assert(fileRead !== undefined);
  assertEquals(fileRead!.namespace, "file");
  assertEquals(fileRead!.family, "file.ops");
  assertEquals(fileRead!.risk_level, "none");
  assertEquals(fileRead!.side_effects, false);
});
Deno.test("namespace-map - applies space file metadata correctly", () => {
  const spaceFilesRead = CUSTOM_TOOLS.find((t) =>
    t.name === "space_files_read"
  );
  assert(spaceFilesRead !== undefined);
  assertEquals(spaceFilesRead!.namespace, "space.files");
  assertEquals(spaceFilesRead!.family, "space.files.ops");
  assertEquals(spaceFilesRead!.risk_level, "none");
  assertEquals(spaceFilesRead!.side_effects, false);
});
Deno.test("namespace-map - applies space skill metadata correctly", () => {
  const skillList = CUSTOM_TOOLS.find((t) => t.name === "skill_list");
  assert(skillList !== undefined);
  assertEquals(skillList!.namespace, "space.skills");
  assertEquals(skillList!.family, "space.skills.ops");
  assertEquals(skillList!.risk_level, "none");
  assertEquals(skillList!.side_effects, false);
});
Deno.test("namespace-map - applies space deployment group metadata correctly", () => {
  const snapshotList = CUSTOM_TOOLS.find(
    (t) => t.name === "group_deployment_snapshot_list",
  );
  assert(snapshotList !== undefined);
  assertEquals(snapshotList!.namespace, "space.groups.deployments");
  assertEquals(snapshotList!.family, "space.groups.deployments.ops");
  assertEquals(snapshotList!.risk_level, "none");
  assertEquals(snapshotList!.side_effects, false);
});
Deno.test("namespace-map - applies deploy metadata correctly", () => {
  const deployFrontend = CUSTOM_TOOLS.find((t) => t.name === "deploy_frontend");
  assert(deployFrontend !== undefined);
  assertEquals(deployFrontend!.namespace, "deploy");
  assertEquals(deployFrontend!.risk_level, "high");
  assertEquals(deployFrontend!.side_effects, true);
});
