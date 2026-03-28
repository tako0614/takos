/**
 * MCP Service
 *
 * Handles OAuth discovery, PKCE flow, token storage, and CRUD for MCP servers.
 * Tokens are stored AES-256-GCM encrypted using the workspace's ENCRYPTION_KEY.
 *
 * This is the barrel re-export entry point. Implementation is split across:
 *   - mcp/mcp-models.ts  - Type definitions and shared constants
 *   - mcp/validation.ts  - Endpoint URL validation
 *   - mcp/crypto.ts      - PKCE and token encryption helpers
 *   - mcp/oauth.ts       - OAuth discovery, pending state, token exchange/refresh
 *   - mcp/crud.ts        - CRUD operations and managed server lifecycle
 */

// Types & constants
export type {
  OAuthMetadata,
  McpOAuthPendingParams,
  McpOAuthCompletionParams,
  McpServerRecord,
  RegisterExternalMcpServerResult,
  McpEndpointUrlOptions,
} from './mcp/mcp-models';

// Validation
export {
  getMcpEndpointUrlOptions,
  assertAllowedMcpEndpointUrl,
} from './mcp/validation';

// OAuth flow
export {
  discoverOAuthMetadata,
  createMcpOAuthPending,
  consumeMcpOAuthPending,
  completeMcpOAuthFlow,
  refreshMcpToken,
  decryptAccessToken,
} from './mcp/oauth';

// CRUD & managed servers
export {
  registerExternalMcpServer,
  upsertManagedMcpServer,
  reconcileManagedWorkerMcpServer,
  deleteManagedMcpServersByBundleDeployment,
  getMcpServerWithTokens,
  listMcpServers,
  deleteMcpServer,
  updateMcpServer,
} from './mcp/crud';
