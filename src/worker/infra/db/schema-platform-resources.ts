import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAtColumn, timestamps } from "./schema-utils.ts";
import { accounts } from "./schema-accounts.ts";

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

// 80. ResourceAccess
export const resourceAccess = sqliteTable("resource_access", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id").notNull().references(() => resources.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  permission: text("permission").notNull().default("read"),
  grantedByAccountId: text("granted_by_account_id").references(() =>
    accounts.id
  ),
  ...createdAtColumn,
}, (table) => ({
  uniqResourceAccount: uniqueIndex("idx_resource_access_resource_account").on(
    table.resourceId,
    table.accountId,
  ),
  idxResource: index("idx_resource_access_resource_id").on(table.resourceId),
  idxAccount: index("idx_resource_access_account_id").on(table.accountId),
}));

// 82. Resource
export const resources = sqliteTable("resources", {
  id: text("id").primaryKey(),
  ownerAccountId: text("owner_account_id").notNull().references(() =>
    accounts.id
  ),
  accountId: text("account_id").references(() => accounts.id),
  groupId: text("group_id"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  semanticType: text("semantic_type"),
  driver: text("driver"),
  backendName: text("backend_name"),
  status: text("status").notNull().default("provisioning"),
  backingResourceId: text("backing_resource_id"),
  backingResourceName: text("backing_resource_name"),
  config: text("config").notNull().default("{}"),
  metadata: text("metadata").notNull().default("{}"),
  sizeBytes: integer("size_bytes").default(0),
  itemCount: integer("item_count").default(0),
  lastUsedAt: text("last_used_at"),
  manifestKey: text("manifest_key"),
  orphanedAt: text("orphaned_at"),
  // Secret rotation grace period: when a secret-typed resource is rotated,
  // the previous value is retained here for 24h so in-flight consumers can
  // continue to verify against the old value while they reload. After the
  // expiry timestamp these columns are lazy-cleared on the next read or
  // rotate operation.
  previousSecretValue: text("previous_secret_value"),
  previousSecretExpiresAt: text("previous_secret_expires_at"),
  ...timestamps,
}, (table) => ({
  idxType: index("idx_resources_type").on(table.type),
  idxSemanticType: index("idx_resources_semantic_type").on(table.semanticType),
  idxBackendName: index("idx_resources_backend_name").on(table.backendName),
  idxStatus: index("idx_resources_status").on(table.status),
  idxOwner: index("idx_resources_owner_account_id").on(table.ownerAccountId),
  idxBackingResourceId: index("idx_resources_backing_resource_id").on(
    table.backingResourceId,
  ),
  idxAccount: index("idx_resources_account_id").on(table.accountId),
  idxGroup: index("idx_resources_group_id").on(table.groupId),
  idxManifestKey: index("idx_resources_manifest_key").on(table.manifestKey),
  idxOrphanedAt: index("idx_resources_orphaned_at").on(table.orphanedAt),
}));

// 83. SecretVersion
export const secretVersions = sqliteTable("secret_versions", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id").notNull().references(() => resources.id),
  name: text("name").notNull(),
  version: text("version").notNull(),
  status: text("status").notNull().default("current"),
  valueDigest: text("value_digest").notNull(),
  cloudPartition: text("cloud_partition").notNull().default("global"),
  rotationPolicy: text("rotation_policy").notNull().default("{}"),
  metadata: text("metadata").notNull().default("{}"),
  activatedAt: text("activated_at").notNull(),
  expiresAt: text("expires_at"),
  supersededByVersionId: text("superseded_by_version_id"),
  createdByAccountId: text("created_by_account_id").references(() =>
    accounts.id
  ),
  ...createdAtColumn,
}, (table) => ({
  uniqResourceVersion: uniqueIndex("idx_secret_versions_resource_version").on(
    table.resourceId,
    table.version,
  ),
  idxResource: index("idx_secret_versions_resource_id").on(table.resourceId),
  idxResourceStatus: index("idx_secret_versions_resource_status").on(
    table.resourceId,
    table.status,
  ),
  idxExpiresAt: index("idx_secret_versions_expires_at").on(table.expiresAt),
  idxSupersededByVersionId: index(
    "idx_secret_versions_superseded_by_version_id",
  ).on(table.supersededByVersionId),
}));

// 84. SecretRotationEvent
export const secretRotationEvents = sqliteTable("secret_rotation_events", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id").notNull().references(() => resources.id),
  secretVersionId: text("secret_version_id").references(() =>
    secretVersions.id
  ),
  eventType: text("event_type").notNull(),
  actorAccountId: text("actor_account_id").references(() => accounts.id),
  reason: text("reason").notNull().default("manual"),
  details: text("details").notNull().default("{}"),
  ...createdAtColumn,
}, (table) => ({
  idxResourceCreatedAt: index("idx_secret_rotation_events_resource_created_at")
    .on(table.resourceId, table.createdAt),
  idxEventType: index("idx_secret_rotation_events_event_type").on(
    table.eventType,
  ),
  idxActor: index("idx_secret_rotation_events_actor_account_id").on(
    table.actorAccountId,
  ),
}));
