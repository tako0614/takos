import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import { FILE_HANDLERS, FILE_TOOLS } from "./file.ts";
import { RUNTIME_HANDLERS, RUNTIME_TOOLS } from "./runtime-tool-executor.ts";
import { STORAGE_HANDLERS, STORAGE_TOOLS } from "./storage.ts";
import { MEMORY_HANDLERS, MEMORY_TOOLS } from "./memory.ts";
import { INFO_UNIT_HANDLERS, INFO_UNIT_TOOLS } from "./info-unit.ts";
import { WEB_HANDLERS, WEB_TOOLS } from "./web.ts";
import { ARTIFACT_HANDLERS, ARTIFACT_TOOLS } from "./artifact.ts";
import { CONTAINER_HANDLERS, CONTAINER_TOOLS } from "./container.ts";
import { REPO_HANDLERS, REPO_TOOLS } from "./repo.ts";
import { PLATFORM_HANDLERS, PLATFORM_TOOLS } from "./platform.ts";
import { DEPLOY_HANDLERS, DEPLOY_TOOLS } from "./deploy.ts";
import { AGENT_HANDLERS, AGENT_TOOLS } from "./agent.ts";
import { MCP_HANDLERS, MCP_TOOLS } from "./mcp.ts";
import { SPACE_FILES_HANDLERS, SPACE_FILES_TOOLS } from "./space-files.ts";
import {
  WORKSPACE_SKILL_HANDLERS,
  WORKSPACE_SKILL_TOOLS,
} from "./space-skills.ts";
import {
  WORKSPACE_DEPLOYMENT_SNAPSHOT_HANDLERS,
  WORKSPACE_DEPLOYMENT_SNAPSHOT_TOOLS,
} from "./group-deployment-snapshots.ts";
import {
  WORKSPACE_SOURCE_HANDLERS,
  WORKSPACE_SOURCE_TOOLS,
} from "./space-source.ts";
import { DISCOVERY_HANDLERS, DISCOVERY_TOOLS } from "./discovery.ts";
import { MEMORY_GRAPH_HANDLERS, MEMORY_GRAPH_TOOLS } from "./memory-graph.ts";
import { applyCustomToolPolicyMetadata } from "../tool-policy.ts";

// Static control-plane custom tool registry.
// Skill tools stay in this registry so they can be managed and still be
// default-injected into the agent-visible custom tool surface.
const RAW_CUSTOM_TOOLS: ToolDefinition[] = [
  ...CONTAINER_TOOLS,
  ...REPO_TOOLS,
  ...FILE_TOOLS,
  ...DEPLOY_TOOLS,
  ...PLATFORM_TOOLS,
  ...RUNTIME_TOOLS,
  ...STORAGE_TOOLS,
  ...MEMORY_TOOLS,
  ...INFO_UNIT_TOOLS,
  ...WEB_TOOLS,
  ...ARTIFACT_TOOLS,
  ...AGENT_TOOLS,
  ...MCP_TOOLS,
  ...SPACE_FILES_TOOLS,
  ...WORKSPACE_SKILL_TOOLS,
  ...WORKSPACE_DEPLOYMENT_SNAPSHOT_TOOLS,
  ...WORKSPACE_SOURCE_TOOLS,
  ...DISCOVERY_TOOLS,
  ...MEMORY_GRAPH_TOOLS,
];

export const CUSTOM_TOOLS: ToolDefinition[] = applyCustomToolPolicyMetadata(
  RAW_CUSTOM_TOOLS,
);

export const CUSTOM_HANDLERS: Record<string, ToolHandler> = {
  ...CONTAINER_HANDLERS,
  ...REPO_HANDLERS,
  ...FILE_HANDLERS,
  ...DEPLOY_HANDLERS,
  ...PLATFORM_HANDLERS,
  ...RUNTIME_HANDLERS,
  ...STORAGE_HANDLERS,
  ...MEMORY_HANDLERS,
  ...INFO_UNIT_HANDLERS,
  ...WEB_HANDLERS,
  ...ARTIFACT_HANDLERS,
  ...AGENT_HANDLERS,
  ...MCP_HANDLERS,
  ...SPACE_FILES_HANDLERS,
  ...WORKSPACE_SKILL_HANDLERS,
  ...WORKSPACE_DEPLOYMENT_SNAPSHOT_HANDLERS,
  ...WORKSPACE_SOURCE_HANDLERS,
  ...DISCOVERY_HANDLERS,
  ...MEMORY_GRAPH_HANDLERS,
};

export const TOOL_CATEGORIES = {
  container: [
    "container_start",
    "container_status",
    "container_commit",
    "container_stop",
    "create_repository",
    "repo_list",
    "repo_status",
    "repo_switch",
  ],
  file: [
    "file_read",
    "file_write",
    "file_write_binary",
    "file_list",
    "file_delete",
    "file_mkdir",
    "file_rename",
    "file_copy",
    "space_files_list",
    "space_files_read",
    "space_files_write",
    "space_files_create",
    "space_files_mkdir",
    "space_files_delete",
    "space_files_rename",
    "space_files_move",
  ],
  deploy: [
    "deploy_frontend",
    "service_list",
    "service_create",
    "service_delete",
    "deployment_history",
    "deployment_get",
    "deployment_rollback",
    "service_env_get",
    "service_env_set",
    "service_runtime_get",
    "service_runtime_set",
    "domain_list",
    "domain_add",
    "domain_verify",
    "domain_remove",
  ],
  runtime: ["runtime_exec", "runtime_status"],
  storage: [
    "key_value_get",
    "key_value_put",
    "key_value_delete",
    "key_value_list",
    "sql_query",
    "sql_tables",
    "sql_describe",
    "object_store_upload",
    "object_store_download",
    "object_store_list",
    "object_store_delete",
    "object_store_info",
    "create_sql",
    "create_key_value",
    "create_object_store",
    "list_resources",
  ],
  space: [
    "skill_list",
    "skill_get",
    "skill_create",
    "skill_update",
    "skill_toggle",
    "skill_delete",
    "skill_context",
    "skill_catalog",
    "skill_describe",
    "group_deployment_snapshot_list",
    "group_deployment_snapshot_get",
    "group_deployment_snapshot_deploy_from_repo",
    "group_deployment_snapshot_remove",
    "group_deployment_snapshot_rollback",
    "store_search",
    "repo_fork",
  ],
  memory: [
    "remember",
    "recall",
    "set_reminder",
    "info_unit_search",
    "repo_graph_search",
    "repo_graph_neighbors",
    "repo_graph_lineage",
  ],
  web: ["web_fetch"],
  artifact: ["create_artifact", "search"],
  agent: ["spawn_agent", "wait_agent"],
  mcp: [
    "mcp_add_server",
    "mcp_list_servers",
    "mcp_update_server",
    "mcp_remove_server",
  ],
} as const;

export function getCustomTool(name: string): ToolDefinition | undefined {
  return CUSTOM_TOOLS.find((t) => t.name === name);
}

export function getCustomHandler(name: string): ToolHandler | undefined {
  return CUSTOM_HANDLERS[name];
}

export function isCustomTool(name: string): boolean {
  return name in CUSTOM_HANDLERS;
}

export function getToolsByCategory(
  category: keyof typeof TOOL_CATEGORIES,
): ToolDefinition[] {
  const names = new Set<string>(TOOL_CATEGORIES[category]);
  return CUSTOM_TOOLS.filter((t) => names.has(t.name));
}
