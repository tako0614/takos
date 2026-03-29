import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps } from './schema-utils';

// 115. StoreRegistry — tracks remote ActivityPub stores known to this instance
export const storeRegistry = sqliteTable('store_registry', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  actorUrl: text('actor_url').notNull(),
  domain: text('domain').notNull(),
  storeSlug: text('store_slug').notNull(),
  name: text('name').notNull(),
  summary: text('summary'),
  iconUrl: text('icon_url'),
  publicKeyPem: text('public_key_pem'),
  repositoriesUrl: text('repositories_url'),
  searchUrl: text('search_url'),
  outboxUrl: text('outbox_url'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  subscriptionEnabled: integer('subscription_enabled', { mode: 'boolean' }).notNull().default(false),
  lastFetchedAt: text('last_fetched_at'),
  lastOutboxCheckedAt: text('last_outbox_checked_at'),
  ...timestamps,
}, (table) => ({
  idxAccount: index('idx_store_registry_account_id').on(table.accountId),
  uniqAccountActor: uniqueIndex('idx_store_registry_account_actor').on(table.accountId, table.actorUrl),
  idxDomain: index('idx_store_registry_domain').on(table.domain),
  idxSubscription: index('idx_store_registry_subscription').on(table.subscriptionEnabled),
}));

// 116. StoreRegistryUpdates — cached updates from remote store outbox polling
export const storeRegistryUpdates = sqliteTable('store_registry_updates', {
  id: text('id').primaryKey(),
  registryEntryId: text('registry_entry_id').notNull(),
  accountId: text('account_id').notNull(),
  activityId: text('activity_id').notNull(),
  activityType: text('activity_type').notNull(),
  objectId: text('object_id').notNull(),
  objectType: text('object_type'),
  objectName: text('object_name'),
  objectSummary: text('object_summary'),
  published: text('published'),
  seen: integer('seen', { mode: 'boolean' }).notNull().default(false),
  rawJson: text('raw_json'),
  ...createdAtColumn,
}, (table) => ({
  idxRegistry: index('idx_store_registry_updates_registry').on(table.registryEntryId),
  idxAccount: index('idx_store_registry_updates_account').on(table.accountId),
  uniqActivity: uniqueIndex('idx_store_registry_updates_activity').on(table.registryEntryId, table.activityId),
  idxSeen: index('idx_store_registry_updates_seen').on(table.accountId, table.seen),
}));
