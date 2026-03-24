import type { StandardCapabilityId } from '../services/platform/capabilities';

/**
 * Tool -> Capability mapping (Agent Tool checks).
 *
 * Only the "standard" capabilities are mapped here.
 * Tool-specific policy (e.g. tool-policy.ts disabling infra tools) remains separate.
 */
export function getRequiredCapabilitiesForTool(toolName: string): StandardCapabilityId[] {
  switch (toolName) {
    case 'web_fetch':
    case 'browser_open':
    case 'browser_goto':
      return ['egress.http'];

    // Container session file operations map to repository read/write.
    case 'file_read':
    case 'file_list':
    case 'repo_list':
    case 'repo_status':
    case 'repo_switch':
      return ['repo.read'];

    case 'create_repository':
    case 'repo_fork':
    case 'container_commit':
    case 'file_write':
    case 'file_write_binary':
    case 'file_delete':
    case 'file_mkdir':
    case 'file_rename':
    case 'file_copy':
      return ['repo.write'];

    // Content search can read workspace file blobs from R2 when available.
    case 'search':
    // falls through — Workspace storage file access
    case 'workspace_files_list':
    case 'workspace_files_read':
      return ['storage.read'];

    case 'workspace_files_write':
    case 'workspace_files_create':
    case 'workspace_files_mkdir':
    case 'workspace_files_delete':
    case 'workspace_files_rename':
    case 'workspace_files_move':
      return ['storage.write'];

    // MCP server management requires outbound HTTP to communicate with OAuth servers.
    case 'mcp_add_server':
    case 'domain_verify':
      return ['egress.http'];

    default:
      return [];
  }
}
