import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAtColumn, timestamps } from "./schema-utils.ts";
import { accounts } from "./schema-accounts.ts";
import { repositories } from "./schema-repos.ts";

/**
 * Index naming note.
 *
 * The applied baseline SQL and the Drizzle declarations do not always use the
 * same naming convention for equivalent indexes. Treat generated
 * index-name-only diffs as intentional schema-change candidates: either apply
 * the rename consistently to every environment or keep the generated migration
 * a no-op. New table declarations should choose explicit `.index()` names that
 * match their applied SQL so the drift set does not grow.
 */

// ── Federation tables ────────────────────────────────────────────────

// 121. APFollowers — ActivityPub follower relationships
export const apFollowers = sqliteTable("ap_followers", {
  id: text("id").primaryKey(),
  targetActorUrl: text("target_actor_url").notNull(),
  followerActorUrl: text("follower_actor_url").notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxTarget: index("idx_ap_followers_target").on(table.targetActorUrl),
  uniqFollow: uniqueIndex("idx_ap_followers_unique").on(
    table.targetActorUrl,
    table.followerActorUrl,
  ),
}));

// 122. APDeliveryQueue — ActivityPub retry/backoff/DLQ message queue
//
// This table persists outbound federation delivery attempts so delivery state
// remains queryable by maintenance tasks.
export const apDeliveryQueue = sqliteTable("ap_delivery_queue", {
  id: text("id").primaryKey(),
  activityId: text("activity_id").notNull(),
  inboxUrl: text("inbox_url").notNull(),
  payload: text("payload").notNull(),
  signingKeyId: text("signing_key_id"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: integer("next_attempt_at").notNull(),
  lastError: text("last_error"),
  status: text("status").notNull().default("pending"),
  ...createdAtColumn,
}, (table) => ({
  idxStatusNext: index("idx_ap_delivery_queue_status_next").on(
    table.status,
    table.nextAttemptAt,
  ),
  idxActivityId: index("idx_ap_delivery_queue_activity_id").on(
    table.activityId,
  ),
}));

// 118. RepoPushActivities — Store Network feed events for repository changes
export const repoPushActivities = sqliteTable("repo_push_activities", {
  id: text("id").primaryKey(),
  // FK to repositories.id is declared by the baseline migration with the same
  // ON DELETE semantics as the SQL; the drizzle thunk only mirrors that fact
  // so drizzle introspection can resolve the relationship.
  repoId: text("repo_id").notNull().references(() => repositories.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  ref: text("ref").notNull(),
  beforeSha: text("before_sha"),
  afterSha: text("after_sha").notNull(),
  pusherActorUrl: text("pusher_actor_url"),
  pusherName: text("pusher_name"),
  commitCount: integer("commit_count").notNull().default(0),
  commitsJson: text("commits_json"),
  repoOwnerSlug: text("repo_owner_slug"),
  repoName: text("repo_name"),
  repoSummary: text("repo_summary"),
  repoVisibility: text("repo_visibility"),
  repoDefaultBranch: text("repo_default_branch"),
  repoDefaultBranchHash: text("repo_default_branch_hash"),
  repoCreatedAt: text("repo_created_at"),
  repoUpdatedAt: text("repo_updated_at"),
  ...createdAtColumn,
}, (table) => ({
  idxRepo: index("idx_push_activities_repo").on(table.repoId),
  idxAccount: index("idx_push_activities_account").on(table.accountId),
  idxAccountCreated: index("idx_push_activities_account_created").on(
    table.accountId,
    table.createdAt,
  ),
  idxCreated: index("idx_push_activities_created").on(
    table.repoId,
    table.createdAt,
  ),
}));

// 119. RepoGrants — capability grants for repo access (visit/read/write/admin)
export const repoGrants = sqliteTable("repo_grants", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull(),
  granteeActorUrl: text("grantee_actor_url").notNull(),
  capability: text("capability").notNull(),
  grantedBy: text("granted_by"),
  expiresAt: text("expires_at"),
  ...createdAtColumn,
}, (table) => ({
  idxRepo: index("idx_repo_grants_repo").on(table.repoId),
  uniqGrant: uniqueIndex("idx_repo_grants_unique").on(
    table.repoId,
    table.granteeActorUrl,
    table.capability,
  ),
}));

// 120. StoreInventoryItems — explicit inventory registration + feed event log
//
// NOTE: migration 0042_store_inventory.sql also creates a partial unique index
// `idx_store_inventory_unique_active ON (account_id, store_slug, repo_actor_url)
// WHERE is_active = 1` that drizzle-kit cannot represent. Application-level
// duplicate detection lives in store-inventory.ts addToInventory(); the partial
// unique index is the DB-side safety net. Do NOT run `drizzle-kit push` against
// this table without first reapplying the partial index by hand.
export const storeInventoryItems = sqliteTable("store_inventory_items", {
  id: text("id").primaryKey(),
  storeSlug: text("store_slug").notNull(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  repoActorUrl: text("repo_actor_url").notNull(),
  repoName: text("repo_name"),
  repoSummary: text("repo_summary"),
  repoOwnerSlug: text("repo_owner_slug"),
  repoCloneUrl: text("repo_clone_url"),
  repoBrowseUrl: text("repo_browse_url"),
  repoDefaultBranch: text("repo_default_branch"),
  repoDefaultBranchHash: text("repo_default_branch_hash"),
  localRepoId: text("local_repo_id"),
  activityType: text("activity_type").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...createdAtColumn,
}, (table) => ({
  idxStore: index("idx_store_inventory_store").on(
    table.accountId,
    table.storeSlug,
  ),
  idxActive: index("idx_store_inventory_active").on(
    table.accountId,
    table.storeSlug,
    table.isActive,
  ),
  idxCreated: index("idx_store_inventory_created").on(
    table.accountId,
    table.storeSlug,
    table.createdAt,
  ),
  idxLocalRepo: index("idx_store_inventory_local_repo").on(table.localRepoId),
}));

// ── Store Registry tables ────────────────────────────────────────────

// 115. StoreRegistry — tracks remote Store Network stores known to this instance
export const storeRegistry = sqliteTable("store_registry", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  actorUrl: text("actor_url").notNull(),
  domain: text("domain").notNull(),
  storeSlug: text("store_slug").notNull(),
  name: text("name").notNull(),
  summary: text("summary"),
  iconUrl: text("icon_url"),
  publicKeyPem: text("public_key_pem"),
  repositoriesUrl: text("repositories_url"),
  searchUrl: text("search_url"),
  outboxUrl: text("outbox_url"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  subscriptionEnabled: integer("subscription_enabled", { mode: "boolean" })
    .notNull().default(false),
  lastFetchedAt: text("last_fetched_at"),
  lastOutboxCheckedAt: text("last_outbox_checked_at"),
  ...timestamps,
}, (table) => ({
  idxAccount: index("idx_store_registry_account_id").on(table.accountId),
  uniqAccountActor: uniqueIndex("idx_store_registry_account_actor").on(
    table.accountId,
    table.actorUrl,
  ),
  idxDomain: index("idx_store_registry_domain").on(table.domain),
  idxSubscription: index("idx_store_registry_subscription").on(
    table.subscriptionEnabled,
  ),
}));

// 116. StoreRegistryUpdates — cached updates from remote store outbox polling
export const storeRegistryUpdates = sqliteTable("store_registry_updates", {
  id: text("id").primaryKey(),
  registryEntryId: text("registry_entry_id").notNull(),
  accountId: text("account_id").notNull(),
  activityId: text("activity_id").notNull(),
  activityType: text("activity_type").notNull(),
  objectId: text("object_id").notNull(),
  objectType: text("object_type"),
  objectName: text("object_name"),
  objectSummary: text("object_summary"),
  published: text("published"),
  seen: integer("seen", { mode: "boolean" }).notNull().default(false),
  rawJson: text("raw_json"),
  ...createdAtColumn,
}, (table) => ({
  idxRegistry: index("idx_store_registry_updates_registry").on(
    table.registryEntryId,
  ),
  idxAccount: index("idx_store_registry_updates_account").on(table.accountId),
  uniqActivity: uniqueIndex("idx_store_registry_updates_activity").on(
    table.registryEntryId,
    table.activityId,
  ),
  idxSeen: index("idx_store_registry_updates_seen").on(
    table.accountId,
    table.seen,
  ),
}));
