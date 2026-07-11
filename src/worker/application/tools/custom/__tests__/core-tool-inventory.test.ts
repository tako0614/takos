import { describe, expect, test } from "bun:test";
import { CUSTOM_TOOLS } from "../registry.ts";

const EXPECTED_CORE_TOOLS = [
  "chat_attachment_read",
  "create_artifact",
  "info_unit_search",
  "mcp_add_server",
  "mcp_list_servers",
  "mcp_remove_server",
  "mcp_update_server",
  "recall",
  "remember",
  "set_reminder",
  "skill_create",
  "skill_delete",
  "skill_get",
  "skill_list",
  "skill_toggle",
  "skill_update",
  "spawn_agent",
  "store_search",
  "toolbox",
  "wait_agent",
  "web_fetch",
] as const;

describe("Takos core tool inventory", () => {
  test("contains only Takos-owned capabilities", () => {
    expect(CUSTOM_TOOLS.map((tool) => tool.name).sort()).toEqual([
      ...EXPECTED_CORE_TOOLS,
    ]);
  });

  test("does not reintroduce Capsule or Takosumi-owned tool families", () => {
    for (const tool of CUSTOM_TOOLS) {
      expect(tool.name).not.toMatch(
        /^(?:container_|computer_|file_|runtime_|space_files_|storage_|key_value_|sql_|object_store_|service_|domain_|deployment_|deploy_frontend$)/,
      );
      expect(tool.name).not.toMatch(/^capability_/);
      expect(tool.name).not.toMatch(/^repo_(?:fork|list|status|switch)$/);
    }
  });

  test("web_fetch exposes only the known-URL fetch contract", () => {
    const webFetch = CUSTOM_TOOLS.find((tool) => tool.name === "web_fetch");
    expect(webFetch).toBeDefined();
    expect(Object.keys(webFetch!.parameters.properties).sort()).toEqual([
      "extract",
      "url",
    ]);
    expect(CUSTOM_TOOLS.some((tool) => tool.name === "web_search")).toBeFalse();
  });
});
