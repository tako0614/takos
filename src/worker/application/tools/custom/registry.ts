import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import { mergeDefinedTools } from "./define-tools.ts";
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
// default-injected into the agent-visible custom tool surface. Each group is a
// `{ tools, handlers }` pair derived from one source list (see defineTools), so
// the tool array and handler map can never drift out of sync.
const { tools: RAW_CUSTOM_TOOLS, handlers: CUSTOM_HANDLERS_MAP } =
  mergeDefinedTools([
    { tools: CONTAINER_TOOLS, handlers: CONTAINER_HANDLERS },
    { tools: REPO_TOOLS, handlers: REPO_HANDLERS },
    { tools: FILE_TOOLS, handlers: FILE_HANDLERS },
    { tools: DEPLOY_TOOLS, handlers: DEPLOY_HANDLERS },
    { tools: PLATFORM_TOOLS, handlers: PLATFORM_HANDLERS },
    { tools: RUNTIME_TOOLS, handlers: RUNTIME_HANDLERS },
    { tools: STORAGE_TOOLS, handlers: STORAGE_HANDLERS },
    { tools: MEMORY_TOOLS, handlers: MEMORY_HANDLERS },
    { tools: INFO_UNIT_TOOLS, handlers: INFO_UNIT_HANDLERS },
    { tools: WEB_TOOLS, handlers: WEB_HANDLERS },
    { tools: ARTIFACT_TOOLS, handlers: ARTIFACT_HANDLERS },
    { tools: AGENT_TOOLS, handlers: AGENT_HANDLERS },
    { tools: MCP_TOOLS, handlers: MCP_HANDLERS },
    { tools: SPACE_FILES_TOOLS, handlers: SPACE_FILES_HANDLERS },
    { tools: WORKSPACE_SKILL_TOOLS, handlers: WORKSPACE_SKILL_HANDLERS },
    { tools: WORKSPACE_SOURCE_TOOLS, handlers: WORKSPACE_SOURCE_HANDLERS },
    { tools: DISCOVERY_TOOLS, handlers: DISCOVERY_HANDLERS },
    { tools: MEMORY_GRAPH_TOOLS, handlers: MEMORY_GRAPH_HANDLERS },
  ]);

export const CUSTOM_TOOLS: ToolDefinition[] = applyCustomToolPolicyMetadata(
  RAW_CUSTOM_TOOLS,
);

export const CUSTOM_HANDLERS: Record<string, ToolHandler> = CUSTOM_HANDLERS_MAP;

export function getCustomTool(name: string): ToolDefinition | undefined {
  return CUSTOM_TOOLS.find((t) => t.name === name);
}

export function getCustomHandler(name: string): ToolHandler | undefined {
  return CUSTOM_HANDLERS[name];
}

export function isCustomTool(name: string): boolean {
  return name in CUSTOM_HANDLERS;
}
