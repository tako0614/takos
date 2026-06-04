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
  ...WORKSPACE_SOURCE_HANDLERS,
  ...DISCOVERY_HANDLERS,
  ...MEMORY_GRAPH_HANDLERS,
};

export function getCustomTool(name: string): ToolDefinition | undefined {
  return CUSTOM_TOOLS.find((t) => t.name === name);
}

export function getCustomHandler(name: string): ToolHandler | undefined {
  return CUSTOM_HANDLERS[name];
}

export function isCustomTool(name: string): boolean {
  return name in CUSTOM_HANDLERS;
}
