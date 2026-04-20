import { CUSTOM_TOOLS, getCustomTool } from "@/tools/custom";
import {
  canRoleAccessTool,
  filterToolsForRole,
  getToolPolicyMetadata,
  validateCustomToolPolicies,
} from "@/tools/tool-policy";
import { getRequiredCapabilitiesForTool } from "@/tools/capabilities";

import { assert, assertEquals, assertObjectMatch } from "jsr:@std/assert";

Deno.test("tool-policy - validates Takos-managed space policy metadata", () => {
  assertEquals(validateCustomToolPolicies(CUSTOM_TOOLS), []);
});
Deno.test("tool-policy - enforces service delete access policy", () => {
  const serviceDelete = getCustomTool("service_delete");

  assert(serviceDelete !== undefined);

  assertEquals(canRoleAccessTool("editor", serviceDelete!), false);
  assertEquals(canRoleAccessTool("owner", serviceDelete!), true);
});
Deno.test("tool-policy - enforces deploy_frontend access policy", () => {
  const deployFrontend = getCustomTool("deploy_frontend");

  assert(deployFrontend !== undefined);

  assertEquals(canRoleAccessTool("editor", deployFrontend!), false);
  assertEquals(canRoleAccessTool("admin", deployFrontend!), true);
});
Deno.test("tool-policy - filters space-mapped tools by space role", () => {
  const tools = [
    getCustomTool("service_list")!,
    getCustomTool("service_delete")!,
    getCustomTool("skill_list")!,
    getCustomTool("skill_update")!,
  ];

  assertEquals(filterToolsForRole(tools, "viewer").map((tool) => tool.name), [
    "service_list",
    "skill_list",
  ]);
  assertEquals(filterToolsForRole(tools, "admin").map((tool) => tool.name), [
    "service_list",
    "service_delete",
    "skill_list",
    "skill_update",
  ]);
});
Deno.test("tool-policy - maps service lifecycle tools to space operations", () => {
  assertObjectMatch(getToolPolicyMetadata("service_delete"), {
    operation_id: "service.delete",
  });
});
Deno.test("tool-policy - maps repository ownership tools to space operations", () => {
  assertObjectMatch(getToolPolicyMetadata("create_repository"), {
    operation_id: "repo.create",
  });
  assertObjectMatch(getToolPolicyMetadata("repo_fork"), {
    operation_id: "repo.fork",
  });
});
Deno.test("tool-policy - hides repo ownership tools from viewers", () => {
  const tools = [
    getCustomTool("create_repository")!,
    getCustomTool("repo_fork")!,
    getCustomTool("store_search")!,
  ];

  assertEquals(filterToolsForRole(tools, "viewer").map((tool) => tool.name), [
    "store_search",
  ]);
  assertEquals(filterToolsForRole(tools, "editor").map((tool) => tool.name), [
    "create_repository",
    "repo_fork",
    "store_search",
  ]);
});
Deno.test("tool-policy - maps skill introspection helpers to space operations", () => {
  assertObjectMatch(getToolPolicyMetadata("skill_catalog"), {
    operation_id: "skill.catalog",
  });
  assertObjectMatch(getToolPolicyMetadata("skill_describe"), {
    operation_id: "skill.describe",
  });
});
Deno.test("tool-policy - exposes skill introspection helpers to viewers", () => {
  const tools = [
    getCustomTool("skill_catalog")!,
    getCustomTool("skill_describe")!,
    getCustomTool("skill_delete")!,
  ];

  assertEquals(filterToolsForRole(tools, "viewer").map((tool) => tool.name), [
    "skill_catalog",
    "skill_describe",
  ]);
});
Deno.test("tool-policy - maps space storage write helpers to storage.write capability", () => {
  assertEquals(getRequiredCapabilitiesForTool("space_files_write"), [
    "storage.write",
  ]);
  assertEquals(getRequiredCapabilitiesForTool("space_files_create"), [
    "storage.write",
  ]);
  assertEquals(getRequiredCapabilitiesForTool("space_files_delete"), [
    "storage.write",
  ]);
});
Deno.test("tool-policy - maps repository ownership helpers to repo capabilities", () => {
  assertEquals(getRequiredCapabilitiesForTool("create_repository"), [
    "repo.write",
  ]);
  assertEquals(getRequiredCapabilitiesForTool("repo_fork"), ["repo.write"]);
  assertEquals(getRequiredCapabilitiesForTool("repo_switch"), ["repo.read"]);
});
