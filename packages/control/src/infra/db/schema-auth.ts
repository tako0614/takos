import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { createdAtColumn } from './schema-utils.ts';

// 16. AuthService
export const authServices = sqliteTable('auth_services', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain').notNull().unique(),
  apiKeyHash: text('api_key_hash').notNull(),
  allowedRedirectUris: text('allowed_redirect_uris'),
  ...createdAtColumn,
}, (table) => ({
  idxDomain: index('idx_auth_services_domain').on(table.domain),
  idxApiKeyHash: index('idx_auth_services_api_key_hash').on(table.apiKeyHash),
}));

// 17. AuthSession
export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  expiresAt: text('expires_at').notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxTokenHash: index('idx_auth_sessions_token_hash').on(table.tokenHash),
  idxExpiresAt: index('idx_auth_sessions_expires_at').on(table.expiresAt),
  idxAccount: index('idx_auth_sessions_account_id').on(table.accountId),
}));

// 68. PersonalAccessToken
export const personalAccessTokens = sqliteTable('personal_access_tokens', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  scopes: text('scopes').notNull().default('*'),
  expiresAt: text('expires_at'),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  idxTokenHash: index('idx_personal_access_tokens_token_hash').on(table.tokenHash),
  idxAccount: index('idx_personal_access_tokens_account_id').on(table.accountId),
}));

// 85. ServiceToken
export const serviceTokens = sqliteTable('service_tokens', {
  id: text('id').primaryKey(),
  serviceName: text('service_name'),
  tokenHash: text('token_hash').notNull().unique(),
  permissions: text('permissions'),
  expiresAt: text('expires_at'),
  ...createdAtColumn,
  accountId: text('account_id'),
}, (table) => ({
  idxTokenHash: index('idx_service_tokens_token_hash').on(table.tokenHash),
}));

// AppToken
export const appTokens = sqliteTable('app_tokens', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  spaceId: text('space_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  scopes: text('scopes').notNull(),        // JSON array of scope strings
  expiresAt: text('expires_at'),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  idxTokenHash: index('idx_app_tokens_token_hash').on(table.tokenHash),
  idxGroupId: index('idx_app_tokens_group_id').on(table.groupId),
}));
