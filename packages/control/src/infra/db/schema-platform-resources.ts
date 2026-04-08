import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps } from './schema-utils.ts';
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

// 80. ResourceAccess
export const resourceAccess = sqliteTable('resource_access', {
  id: text('id').primaryKey(),
  resourceId: text('resource_id').notNull().references(() => resources.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  permission: text('permission').notNull().default('read'),
  grantedByAccountId: text('granted_by_account_id').references(() => accounts.id),
  ...createdAtColumn,
}, (table) => ({
  uniqResourceAccount: uniqueIndex('idx_resource_access_resource_account').on(table.resourceId, table.accountId),
  idxResource: index('idx_resource_access_resource_id').on(table.resourceId),
  idxAccount: index('idx_resource_access_account_id').on(table.accountId),
}));

// 81. ResourceAccessToken
export const resourceAccessTokens = sqliteTable('resource_access_tokens', {
  id: text('id').primaryKey(),
  resourceId: text('resource_id').notNull().references(() => resources.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  permission: text('permission').notNull().default('read'),
  expiresAt: text('expires_at'),
  lastUsedAt: text('last_used_at'),
  createdBy: text('created_by').notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxTokenHash: index('idx_resource_access_tokens_token_hash').on(table.tokenHash),
  idxResource: index('idx_resource_access_tokens_resource_id').on(table.resourceId),
}));

// 82. Resource
export const resources = sqliteTable('resources', {
  id: text('id').primaryKey(),
  ownerAccountId: text('owner_account_id').notNull().references(() => accounts.id),
  accountId: text('account_id').references(() => accounts.id),
  groupId: text('group_id'),
  name: text('name').notNull(),
  type: text('type').notNull(),
  semanticType: text('semantic_type'),
  driver: text('driver'),
  providerName: text('provider_name'),
  status: text('status').notNull().default('provisioning'),
  providerResourceId: text('provider_resource_id'),
  providerResourceName: text('provider_resource_name'),
  config: text('config').notNull().default('{}'),
  metadata: text('metadata').notNull().default('{}'),
  sizeBytes: integer('size_bytes').default(0),
  itemCount: integer('item_count').default(0),
  lastUsedAt: text('last_used_at'),
  manifestKey: text('manifest_key'),
  orphanedAt: text('orphaned_at'),
  // Secret rotation grace period: when a secret-typed resource is rotated,
  // the previous value is retained here for 24h so in-flight consumers can
  // continue to verify against the old value while they reload. After the
  // expiry timestamp these columns are lazy-cleared on the next read or
  // rotate operation.
  previousSecretValue: text('previous_secret_value'),
  previousSecretExpiresAt: text('previous_secret_expires_at'),
  ...timestamps,
}, (table) => ({
  idxType: index('idx_resources_type').on(table.type),
  idxSemanticType: index('idx_resources_semantic_type').on(table.semanticType),
  idxProviderName: index('idx_resources_provider_name').on(table.providerName),
  idxStatus: index('idx_resources_status').on(table.status),
  idxOwner: index('idx_resources_owner_account_id').on(table.ownerAccountId),
  idxProviderResourceId: index('idx_resources_provider_resource_id').on(table.providerResourceId),
  idxAccount: index('idx_resources_account_id').on(table.accountId),
  idxGroup: index('idx_resources_group_id').on(table.groupId),
  idxManifestKey: index('idx_resources_manifest_key').on(table.manifestKey),
  idxOrphanedAt: index('idx_resources_orphaned_at').on(table.orphanedAt),
}));
