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
  McpEndpointUrlOptions,
  McpOAuthCompletionParams,
  McpOAuthPendingParams,
  McpServerRecord,
  OAuthMetadata,
  RegisterExternalMcpServerResult,
} from "./mcp/mcp-models.ts";

// Validation
export {
  assertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions,
} from "./mcp/validation.ts";

// OAuth flow
export {
  completeMcpOAuthFlow,
  consumeMcpOAuthPending,
  createMcpOAuthPending,
  decryptAccessToken,
  discoverOAuthMetadata,
  mcpServiceDeps,
  refreshMcpToken,
} from "./mcp/oauth.ts";

// CRUD & managed servers
export {
  deleteManagedMcpServersByBundleDeployment,
  deleteMcpServer,
  getMcpServerWithTokens,
  listMcpServers,
  reconcileManagedWorkerMcpServer,
  registerExternalMcpServer,
  updateMcpServer,
  upsertManagedMcpServer,
} from "./mcp/crud.ts";
