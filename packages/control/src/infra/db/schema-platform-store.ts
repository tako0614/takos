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

// 122. APDeliveryQueue — retry/backoff/DLQ queue for outbound ActivityPub POSTs
//
// Round 11 audit finding #4: deliverToFollowers previously used one-shot
// Promise.allSettled and silently dropped failed deliveries. This table
// persists each (activity, inbox) pair so the hourly cron tick can replay
// failed POSTs with exponential backoff until either a 2xx or the
// dead-letter threshold (attempts >= 7) is reached.
export const apDeliveryQueue = sqliteTable('ap_delivery_queue', {
  id: text('id').primaryKey(),
  activityId: text('activity_id').notNull(),
  inboxUrl: text('inbox_url').notNull(),
  payload: text('payload').notNull(),
  signingKeyId: text('signing_key_id'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at').notNull(),
  lastError: text('last_error'),
  status: text('status').notNull().default('pending'),
  ...createdAtColumn,
}, (table) => ({
  idxStatusNext: index('idx_ap_delivery_queue_status_next').on(table.status, table.nextAttemptAt),
  idxActivityId: index('idx_ap_delivery_queue_activity_id').on(table.activityId),
}));

// 118. RepoPushActivities — ForgeFed Push activities for repo outbox
export const repoPushActivities = sqliteTable('repo_push_activities', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id),
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
//
// NOTE: migration 0042_store_inventory.sql also creates a partial unique index
// `idx_store_inventory_unique_active ON (account_id, store_slug, repo_actor_url)
// WHERE is_active = 1` that drizzle-kit cannot represent. Application-level
// duplicate detection lives in store-inventory.ts addToInventory(); the partial
// unique index is the DB-side safety net. Do NOT run `drizzle-kit push` against
// this table without first reapplying the partial index by hand.
export const storeInventoryItems = sqliteTable('store_inventory_items', {
  id: text('id').primaryKey(),
  storeSlug: text('store_slug').notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id),
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
  accountId: text('account_id').notNull().references(() => accounts.id),
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
