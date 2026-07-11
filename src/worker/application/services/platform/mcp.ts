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
  McpOAuthRegistrationMode,
  McpServerRecord,
  RegisterExternalMcpServerResult,
} from "./mcp/mcp-models.ts";

// Validation
export {
  assertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions,
} from "./mcp/validation.ts";

// Publication bearer token metadata
export {
  mcpAuthSecretDeps,
  readPublicationAuthSecretRef,
  resolvePublicationAuthToken,
} from "./mcp/auth-secret.ts";

// OAuth flow
export {
  beginMcpAuthorization,
  completeMcpOAuthFlow,
  consumeMcpOAuthPending,
  createMcpOAuthPending,
  decryptAccessToken,
  getMcpOAuthPendingForStart,
  McpOAuthBrowserBindingError,
  McpOAuthPendingUpgradeRequiredError,
  mcpServiceDeps,
  refreshMcpToken,
} from "./mcp/oauth.ts";

// CRUD & managed servers
export {
  deleteManagedMcpServersByBundleDeployment,
  deleteMcpServer,
  getMcpServerWithTokens,
  listMcpServers,
  reauthorizeExternalMcpServer,
  reconcileManagedWorkerMcpServer,
  registerExternalMcpServer,
  resolvePublicationMcpServerAccessToken,
  updateMcpServer,
  upsertManagedMcpServer,
} from "./mcp/crud.ts";

// Registry discovery sources + bounded live search
export type {
  CustomMcpRegistrySourceKind,
  McpRegistrySearchCandidate,
  McpRegistrySearchFailure,
  McpRegistrySearchResult,
  McpRegistrySourceInput,
  McpRegistrySourceKind,
  McpRegistrySourcePatch,
  McpRegistrySourceRecord,
} from "./mcp/registry-sources.ts";
export {
  createMcpRegistrySource,
  CUSTOM_MCP_REGISTRY_SOURCE_KINDS,
  deleteMcpRegistrySource,
  listMcpRegistrySources,
  normalizeMcpRegistryBaseUrl,
  OFFICIAL_MCP_REGISTRY_BASE_URL,
  OFFICIAL_MCP_REGISTRY_SOURCE_ID,
  searchMcpRegistrySources,
  updateMcpRegistrySource,
} from "./mcp/registry-sources.ts";
