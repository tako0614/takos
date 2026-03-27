import type { StandardCapabilityId } from '../services/platform/capabilities';

/**
 * Tool -> Capability mapping (Agent Tool checks).
 *
 * Only the "standard" capabilities are mapped here.
 * Tool-specific policy (e.g. tool-policy.ts disabling infra tools) remains separate.
 */
const TOOL_CAPABILITIES: Record<string, StandardCapabilityId[]> = {
  // Outbound HTTP
  'web_fetch': ['egress.http'],
  'browser_open': ['egress.http'],
  'browser_goto': ['egress.http'],

  // Container session file operations map to repository read/write.
  'file_read': ['repo.read'],
  'file_list': ['repo.read'],
  'repo_list': ['repo.read'],
  'repo_status': ['repo.read'],
  'repo_switch': ['repo.read'],

  'create_repository': ['repo.write'],
  'repo_fork': ['repo.write'],
  'container_commit': ['repo.write'],
  'file_write': ['repo.write'],
  'file_write_binary': ['repo.write'],
  'file_delete': ['repo.write'],
  'file_mkdir': ['repo.write'],
  'file_rename': ['repo.write'],
  'file_copy': ['repo.write'],

  // Content search can read workspace file blobs from R2 when available.
  'search': ['storage.read'],
  'workspace_files_list': ['storage.read'],
  'workspace_files_read': ['storage.read'],

  'workspace_files_write': ['storage.write'],
  'workspace_files_create': ['storage.write'],
  'workspace_files_mkdir': ['storage.write'],
  'workspace_files_delete': ['storage.write'],
  'workspace_files_rename': ['storage.write'],
  'workspace_files_move': ['storage.write'],

  // MCP server management requires outbound HTTP to communicate with OAuth servers.
  'mcp_add_server': ['egress.http'],
  'domain_verify': ['egress.http'],
};

export function getRequiredCapabilitiesForTool(toolName: string): StandardCapabilityId[] {
  return TOOL_CAPABILITIES[toolName] ?? [];
}
