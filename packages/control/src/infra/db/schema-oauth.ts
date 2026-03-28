import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps, updatedAtColumn } from './schema-helpers';

// 50. McpOAuthPending
export const mcpOauthPending = sqliteTable('mcp_oauth_pending', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  serverName: text('server_name').notNull(),
  serverUrl: text('server_url').notNull(),
  state: text('state').notNull().unique(),
  codeVerifier: text('code_verifier').notNull(),
  issuerUrl: text('issuer_url').notNull(),
  tokenEndpoint: text('token_endpoint').notNull(),
  scope: text('scope'),
  expiresAt: text('expires_at').notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxState: index('idx_mcp_oauth_pending_state').on(table.state),
  idxAccount: index('idx_mcp_oauth_pending_account_id').on(table.accountId),
}));

// 51. McpServer
const mcpServersTable = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  transport: text('transport').notNull().default('streamable-http'),
  sourceType: text('source_type').notNull().default('external'),
  authMode: text('auth_mode').notNull().default('oauth_pkce'),
  serviceId: text('service_id'),
  bundleDeploymentId: text('bundle_deployment_id'),
  oauthAccessToken: text('oauth_access_token'),
  oauthRefreshToken: text('oauth_refresh_token'),
  oauthTokenExpiresAt: text('oauth_token_expires_at'),
  oauthScope: text('oauth_scope'),
  oauthIssuerUrl: text('oauth_issuer_url'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
}, (table) => ({
  uniqAccountName: uniqueIndex('idx_mcp_servers_account_name').on(table.accountId, table.name),
  idxService: index('idx_mcp_servers_service_id').on(table.serviceId),
  idxBundleDeployment: index('idx_mcp_servers_bundle_deployment_id').on(table.bundleDeploymentId),
  idxAccount: index('idx_mcp_servers_account_id').on(table.accountId),
}));

export const mcpServers = Object.assign(mcpServersTable, {
  workerId: mcpServersTable.serviceId,
});

// 59. OAuthAuditLog
export const oauthAuditLogs = sqliteTable('oauth_audit_logs', {
  id: text('id').primaryKey(),
  accountId: text('account_id'),
  clientId: text('client_id'),
  eventType: text('event_type').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  details: text('details').notNull().default('{}'),
  ...createdAtColumn,
}, (table) => ({
  idxEventType: index('idx_oauth_audit_logs_event_type').on(table.eventType),
  idxCreatedAt: index('idx_oauth_audit_logs_created_at').on(table.createdAt),
  idxClient: index('idx_oauth_audit_logs_client_id').on(table.clientId),
  idxAccount: index('idx_oauth_audit_logs_account_id').on(table.accountId),
}));

// 60. OAuthAuthorizationCode
export const oauthAuthorizationCodes = sqliteTable('oauth_authorization_codes', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(),
  clientId: text('client_id').notNull(),
  accountId: text('account_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  used: integer('used', { mode: 'boolean' }).notNull().default(false),
  expiresAt: text('expires_at').notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxExpiresAt: index('idx_oauth_authorization_codes_expires_at').on(table.expiresAt),
  idxCodeHash: index('idx_oauth_authorization_codes_code_hash').on(table.codeHash),
  idxClient: index('idx_oauth_authorization_codes_client_id').on(table.clientId),
}));

// 61. OAuthClient
export const oauthClients = sqliteTable('oauth_clients', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecretHash: text('client_secret_hash'),
  clientType: text('client_type').notNull().default('confidential'),
  name: text('name').notNull(),
  description: text('description'),
  logoUri: text('logo_uri'),
  clientUri: text('client_uri'),
  policyUri: text('policy_uri'),
  tosUri: text('tos_uri'),
  redirectUris: text('redirect_uris').notNull(),
  grantTypes: text('grant_types').notNull().default('["authorization_code","refresh_token"]'),
  responseTypes: text('response_types').notNull().default('["code"]'),
  allowedScopes: text('allowed_scopes').notNull(),
  ownerAccountId: text('owner_account_id'),
  registrationAccessTokenHash: text('registration_access_token_hash'),
  status: text('status').notNull().default('active'),
  ...timestamps,
}, (table) => ({
  idxStatus: index('idx_oauth_clients_status').on(table.status),
  idxOwner: index('idx_oauth_clients_owner_account_id').on(table.ownerAccountId),
  idxClientId: index('idx_oauth_clients_client_id').on(table.clientId),
}));

// 63. OAuthConsent
export const oauthConsents = sqliteTable('oauth_consents', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  clientId: text('client_id').notNull(),
  scopes: text('scopes').notNull(),
  status: text('status').notNull().default('active'),
  grantedAt: text('granted_at').notNull().$defaultFn(() => new Date().toISOString()),
  ...updatedAtColumn,
}, (table) => ({
  uniqAccountClient: uniqueIndex('idx_oauth_consents_account_client').on(table.accountId, table.clientId),
  idxClient: index('idx_oauth_consents_client_id').on(table.clientId),
  idxAccount: index('idx_oauth_consents_account_id').on(table.accountId),
}));

// 64. OAuthDeviceCode
export const oauthDeviceCodes = sqliteTable('oauth_device_codes', {
  id: text('id').primaryKey(),
  deviceCodeHash: text('device_code_hash').notNull().unique(),
  userCodeHash: text('user_code_hash').notNull().unique(),
  clientId: text('client_id').notNull(),
  scope: text('scope').notNull(),
  status: text('status').notNull().default('pending'),
  accountId: text('account_id'),
  intervalSeconds: integer('interval_seconds').notNull().default(5),
  lastPolledAt: text('last_polled_at'),
  approvedAt: text('approved_at'),
  deniedAt: text('denied_at'),
  usedAt: text('used_at'),
  expiresAt: text('expires_at').notNull(),
  ...timestamps,
}, (table) => ({
  idxUserCodeHash: index('idx_oauth_device_codes_user_code_hash').on(table.userCodeHash),
  idxStatus: index('idx_oauth_device_codes_status').on(table.status),
  idxExpiresAt: index('idx_oauth_device_codes_expires_at').on(table.expiresAt),
  idxDeviceCodeHash: index('idx_oauth_device_codes_device_code_hash').on(table.deviceCodeHash),
  idxClient: index('idx_oauth_device_codes_client_id').on(table.clientId),
  idxAccount: index('idx_oauth_device_codes_account_id').on(table.accountId),
}));

// 65. OAuthState
export const oauthStates = sqliteTable('oauth_states', {
  id: text('id').primaryKey(),
  state: text('state').notNull().unique(),
  redirectUri: text('redirect_uri').notNull(),
  returnTo: text('return_to'),
  cliCallback: text('cli_callback'),
  expiresAt: text('expires_at').notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxState: index('idx_oauth_states_state').on(table.state),
  idxExpiresAt: index('idx_oauth_states_expires_at').on(table.expiresAt),
}));

// 66. OAuthToken
export const oauthTokens = sqliteTable('oauth_tokens', {
  id: text('id').primaryKey(),
  tokenType: text('token_type').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  clientId: text('client_id').notNull(),
  accountId: text('account_id').notNull(),
  scope: text('scope').notNull(),
  refreshTokenId: text('refresh_token_id'),
  revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
  revokedAt: text('revoked_at'),
  revokedReason: text('revoked_reason'),
  usedAt: text('used_at'),
  tokenFamily: text('token_family'),
  expiresAt: text('expires_at').notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxTokenType: index('idx_oauth_tokens_token_type').on(table.tokenType),
  idxTokenHash: index('idx_oauth_tokens_token_hash').on(table.tokenHash),
  idxTokenFamily: index('idx_oauth_tokens_token_family').on(table.tokenFamily),
  idxRevoked: index('idx_oauth_tokens_revoked').on(table.revoked),
  idxExpiresAt: index('idx_oauth_tokens_expires_at').on(table.expiresAt),
  idxClient: index('idx_oauth_tokens_client_id').on(table.clientId),
  idxAccountRevoked: index('idx_oauth_tokens_account_revoked').on(table.accountId, table.revoked),
  idxAccount: index('idx_oauth_tokens_account_id').on(table.accountId),
}));
