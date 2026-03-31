import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps } from './schema-utils.ts';

// ── Federation tables ────────────────────────────────────────────────

// 121. APFollowers — ActivityPub follower relationships (Store/Repo followers)
export const apFollowers = sqliteTable('ap_followers', {
  id: text('id').primaryKey(),
  targetActorUrl: text('target_actor_url').notNull(),
  followerActorUrl: text('follower_actor_url').notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxTarget: index('idx_ap_followers_target').on(table.targetActorUrl),
  uniqFollow: uniqueIndex('idx_ap_followers_unique').on(table.targetActorUrl, table.followerActorUrl),
}));

// 118. RepoPushActivities — ForgeFed Push activities for repo outbox
export const repoPushActivities = sqliteTable('repo_push_activities', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  accountId: text('account_id').notNull(),
  ref: text('ref').notNull(),
  beforeSha: text('before_sha'),
  afterSha: text('after_sha').notNull(),
  pusherActorUrl: text('pusher_actor_url'),
  pusherName: text('pusher_name'),
  commitCount: integer('commit_count').notNull().default(0),
  commitsJson: text('commits_json'),
  ...createdAtColumn,
}, (table) => ({
  idxRepo: index('idx_push_activities_repo').on(table.repoId),
  idxAccount: index('idx_push_activities_account').on(table.accountId),
  idxCreated: index('idx_push_activities_created').on(table.repoId, table.createdAt),
}));

// 119. RepoGrants — capability grants for repo access (visit/read/write/admin)
export const repoGrants = sqliteTable('repo_grants', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  granteeActorUrl: text('grantee_actor_url').notNull(),
  capability: text('capability').notNull(),
  grantedBy: text('granted_by'),
  expiresAt: text('expires_at'),
  ...createdAtColumn,
}, (table) => ({
  idxRepo: index('idx_repo_grants_repo').on(table.repoId),
  uniqGrant: uniqueIndex('idx_repo_grants_unique').on(table.repoId, table.granteeActorUrl, table.capability),
}));

// 120. StoreInventoryItems — explicit inventory registration + outbox activity log
export const storeInventoryItems = sqliteTable('store_inventory_items', {
  id: text('id').primaryKey(),
  storeSlug: text('store_slug').notNull(),
  accountId: text('account_id').notNull(),
  repoActorUrl: text('repo_actor_url').notNull(),
  repoName: text('repo_name'),
  repoSummary: text('repo_summary'),
  repoOwnerSlug: text('repo_owner_slug'),
  localRepoId: text('local_repo_id'),
  activityType: text('activity_type').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...createdAtColumn,
}, (table) => ({
  idxStore: index('idx_store_inventory_store').on(table.accountId, table.storeSlug),
  idxActive: index('idx_store_inventory_active').on(table.accountId, table.storeSlug, table.isActive),
  idxCreated: index('idx_store_inventory_created').on(table.accountId, table.storeSlug, table.createdAt),
  idxLocalRepo: index('idx_store_inventory_local_repo').on(table.localRepoId),
}));

// ── Store Registry tables ────────────────────────────────────────────

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
