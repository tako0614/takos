import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { createdAtColumn } from './schema-utils.ts';
import { accounts } from './schema-accounts.ts';

/**
 * Index naming drift NOTE (Round 11 audit Finding #6).
 *
 * Drizzle declarations here use the `idx_<table>_<col>` prefix pattern.
 * The baseline migration (apps/control/db/migrations/0001_baseline.sql)
 * uses the legacy `<table>_<col>_idx` suffix pattern. Both names point at
 * the same physical index in the live D1 database (the one created by the
 * baseline migration). Drizzle-kit `generate` will see this as drift and
 * try to emit hundreds of rename statements. Do NOT run drizzle-kit
 * generate against this schema without first deciding whether to:
 *   (a) accept the rename migration and apply it to all environments, or
 *   (b) hand-edit the generated migration to a no-op.
 *
 * Newer tables (auth_identities, usage_events, service_runtimes,
 * memory_*) intentionally match the legacy suffix shape via explicit
 * .index() names so they don't add to the drift.
 */

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
  accountId: text('account_id').notNull().references(() => accounts.id),
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
  accountId: text('account_id').notNull().references(() => accounts.id),
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
