import type { ToolDefinition, ToolHandler } from '../types';
import { FILE_TOOLS, FILE_HANDLERS } from './file';
import { RUNTIME_TOOLS, RUNTIME_HANDLERS } from './runtime';
import { STORAGE_TOOLS, STORAGE_HANDLERS } from './storage';
import { MEMORY_TOOLS, MEMORY_HANDLERS } from './memory';
import { INFO_UNIT_TOOLS, INFO_UNIT_HANDLERS } from './info-unit';
import { WEB_TOOLS, WEB_HANDLERS } from './web';
import { ARTIFACT_TOOLS, ARTIFACT_HANDLERS } from './artifact';
import { CONTAINER_TOOLS, CONTAINER_HANDLERS } from './container';
import { REPO_TOOLS, REPO_HANDLERS } from './repo';
import { PLATFORM_TOOLS, PLATFORM_HANDLERS } from './platform';
import { DEPLOY_TOOLS, DEPLOY_HANDLERS } from './deploy';
import { AGENT_TOOLS, AGENT_HANDLERS } from './agent';
import { MCP_TOOLS, MCP_HANDLERS } from './mcp';
import { WORKSPACE_FILES_TOOLS, WORKSPACE_FILES_HANDLERS } from './workspace-files';
import { WORKSPACE_COMMON_ENV_TOOLS, WORKSPACE_COMMON_ENV_HANDLERS } from './workspace-common-env';
import { WORKSPACE_SKILL_TOOLS, WORKSPACE_SKILL_HANDLERS } from './workspace-skills';
import {
  WORKSPACE_APP_DEPLOYMENT_TOOLS,
  WORKSPACE_APP_DEPLOYMENT_HANDLERS,
} from './workspace-app-deployments';
import {
  WORKSPACE_SOURCE_TOOLS,
  WORKSPACE_SOURCE_HANDLERS,
} from './workspace-source';
import { BROWSER_TOOLS, BROWSER_HANDLERS } from './browser';
import { DISCOVERY_TOOLS, DISCOVERY_HANDLERS } from './discovery';
import { MEMORY_GRAPH_TOOLS, MEMORY_GRAPH_HANDLERS } from './memory-graph';
import { applyBuiltinToolPolicyMetadata } from '../tool-policy';

const RAW_BUILTIN_TOOLS: ToolDefinition[] = [
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
  ...WORKSPACE_FILES_TOOLS,
  ...WORKSPACE_COMMON_ENV_TOOLS,
  ...WORKSPACE_SKILL_TOOLS,
  ...WORKSPACE_APP_DEPLOYMENT_TOOLS,
  ...WORKSPACE_SOURCE_TOOLS,
  ...BROWSER_TOOLS,
  ...DISCOVERY_TOOLS,
  ...MEMORY_GRAPH_TOOLS,
];

export const BUILTIN_TOOLS: ToolDefinition[] = applyBuiltinToolPolicyMetadata(RAW_BUILTIN_TOOLS);

export const BUILTIN_HANDLERS: Record<string, ToolHandler> = {
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
  ...WORKSPACE_FILES_HANDLERS,
  ...WORKSPACE_COMMON_ENV_HANDLERS,
  ...WORKSPACE_SKILL_HANDLERS,
  ...WORKSPACE_APP_DEPLOYMENT_HANDLERS,
  ...WORKSPACE_SOURCE_HANDLERS,
  ...BROWSER_HANDLERS,
  ...DISCOVERY_HANDLERS,
  ...MEMORY_GRAPH_HANDLERS,
};

export const TOOL_CATEGORIES = {
  container: ['container_start', 'container_status', 'container_commit', 'container_stop', 'create_repository', 'repo_list', 'repo_status', 'repo_switch'],
  file: [
    'file_read', 'file_write', 'file_write_binary', 'file_list', 'file_delete', 'file_mkdir', 'file_rename', 'file_copy',
    'workspace_files_list', 'workspace_files_read', 'workspace_files_write', 'workspace_files_create',
    'workspace_files_mkdir', 'workspace_files_delete', 'workspace_files_rename', 'workspace_files_move',
  ],
  deploy: [
    'deploy_frontend',
    'service_list', 'service_create', 'service_delete',
    'deployment_history', 'deployment_get', 'deployment_rollback',
    'service_env_get', 'service_env_set',
    'service_bindings_get', 'service_bindings_set',
    'service_runtime_get', 'service_runtime_set',
    'domain_list', 'domain_add', 'domain_verify', 'domain_remove',
  ],
  runtime: ['runtime_exec', 'runtime_status'],
  storage: [
    'kv_get', 'kv_put', 'kv_delete', 'kv_list',
    'd1_query', 'd1_tables', 'd1_describe',
    'r2_upload', 'r2_download', 'r2_list', 'r2_delete', 'r2_info',
    'create_d1', 'create_kv', 'create_r2', 'list_resources',
  ],
  workspace: [
    'workspace_env_list', 'workspace_env_set', 'workspace_env_delete',
    'skill_list', 'skill_get', 'skill_create', 'skill_update', 'skill_toggle', 'skill_delete', 'skill_context', 'skill_catalog', 'skill_describe',
    'app_deployment_list', 'app_deployment_get', 'app_deployment_deploy_from_repo', 'app_deployment_remove', 'app_deployment_rollback',
    'store_search', 'repo_fork',
  ],
  memory: ['remember', 'recall', 'set_reminder', 'info_unit_search', 'repo_graph_search', 'repo_graph_neighbors', 'repo_graph_lineage'],
  web: ['web_fetch'],
  artifact: ['create_artifact', 'search'],
  agent: ['spawn_agent', 'wait_agent'],
  mcp: ['mcp_add_server', 'mcp_list_servers', 'mcp_update_server', 'mcp_remove_server'],
  browser: ['browser_open', 'browser_goto', 'browser_action', 'browser_screenshot', 'browser_extract', 'browser_html', 'browser_close'],
} as const;

export function getBuiltinTool(name: string): ToolDefinition | undefined {
  return BUILTIN_TOOLS.find(t => t.name === name);
}

export function getBuiltinHandler(name: string): ToolHandler | undefined {
  return BUILTIN_HANDLERS[name];
}

export function isBuiltinTool(name: string): boolean {
  return name in BUILTIN_HANDLERS;
}

export function getToolsByCategory(category: keyof typeof TOOL_CATEGORIES): ToolDefinition[] {
  const names = TOOL_CATEGORIES[category];
  return BUILTIN_TOOLS.filter(t => names.includes(t.name as never));
}

export * from './container';
export * from './repo';
export * from './file';
export * from './platform';
export * from './runtime';
export * from './storage';
export * from './memory';
export * from './info-unit';
export * from './web';
export * from './artifact';
export * from './deploy';
export * from './agent';
export * from './mcp';
export * from './workspace-files';
export * from './workspace-common-env';
export * from './workspace-skills';
export * from './workspace-app-deployments';
export * from './workspace-source';
export * from './browser';
