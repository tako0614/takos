import { getRequiredCapabilitiesForTool } from "@/tools/capabilities";

import { assertEquals } from "jsr:@std/assert";

for (
  const toolName of [
    "web_fetch",
    "browser_open",
    "browser_goto",
    "mcp_add_server",
    "domain_verify",
  ]
) {
  Deno.test(`requires egress.http for ${toolName}`, () => {
    const caps = getRequiredCapabilitiesForTool(toolName);
    assertEquals(caps.includes("egress.http"), true);
  });
}

for (
  const toolName of [
    "file_read",
    "file_list",
    "repo_list",
    "repo_status",
    "repo_switch",
  ]
) {
  Deno.test(`requires repo.read for ${toolName}`, () => {
    const caps = getRequiredCapabilitiesForTool(toolName);
    assertEquals(caps.includes("repo.read"), true);
  });
}

for (
  const toolName of [
    "create_repository",
    "repo_fork",
    "container_commit",
    "file_write",
    "file_write_binary",
    "file_delete",
    "file_mkdir",
    "file_rename",
    "file_copy",
  ]
) {
  Deno.test(`requires repo.write for ${toolName}`, () => {
    const caps = getRequiredCapabilitiesForTool(toolName);
    assertEquals(caps.includes("repo.write"), true);
  });
}

for (
  const toolName of [
    "search",
    "workspace_files_list",
    "workspace_files_read",
  ]
) {
  Deno.test(`requires storage.read for ${toolName}`, () => {
    const caps = getRequiredCapabilitiesForTool(toolName);
    assertEquals(caps.includes("storage.read"), true);
  });
}

for (
  const toolName of [
    "workspace_files_write",
    "workspace_files_create",
    "workspace_files_mkdir",
    "workspace_files_delete",
    "workspace_files_rename",
    "workspace_files_move",
  ]
) {
  Deno.test(`requires storage.write for ${toolName}`, () => {
    const caps = getRequiredCapabilitiesForTool(toolName);
    assertEquals(caps.includes("storage.write"), true);
  });
}

for (
  const toolName of [
    "remember",
    "recall",
    "container_start",
    "container_stop",
    "runtime_exec",
    "create_artifact",
    "spawn_agent",
    "wait_agent",
    "some_unknown_tool",
  ]
) {
  Deno.test(`returns empty array for ${toolName}`, () => {
    const caps = getRequiredCapabilitiesForTool(toolName);
    assertEquals(caps, []);
  });
}
