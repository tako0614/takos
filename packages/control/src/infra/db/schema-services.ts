import { sql } from "drizzle-orm";
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

const servicesTable = sqliteTable("services", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  groupId: text("group_id"),
  serviceType: text("service_type").notNull().default("app"),
  nameType: text("name_type"),
  status: text("status").notNull().default("pending"),
  config: text("config"),
  hostname: text("hostname").unique(),
  routeRef: text("route_ref").unique(),
  slug: text("slug").unique(),
  activeDeploymentId: text("active_deployment_id"),
  fallbackDeploymentId: text("fallback_deployment_id"),
  currentVersion: integer("current_version").notNull().default(0),
  workloadKind: text("workload_kind"),
  ...timestamps,
}, (table) => ({
  uniqIdAccount: uniqueIndex("idx_services_id_account").on(
    table.id,
    table.accountId,
  ),
  idxStatus: index("idx_services_status").on(table.status),
  idxHostname: index("idx_services_hostname").on(table.hostname),
  idxAccountStatus: index("idx_services_account_status").on(
    table.accountId,
    table.status,
  ),
  idxAccount: index("idx_services_account_id").on(table.accountId),
  idxGroup: index("idx_services_group_id").on(table.groupId),
}));

export const services = Object.assign(servicesTable, {
  workerType: servicesTable.serviceType,
});

export const serviceBindings = sqliteTable("service_bindings", {
  id: text("id").primaryKey(),
  serviceId: text("service_id").notNull().references(() => servicesTable.id),
  resourceId: text("resource_id").notNull(),
  bindingName: text("binding_name").notNull(),
  bindingType: text("binding_type").notNull(),
  config: text("config").notNull().default("{}"),
  ...createdAtColumn,
}, (table) => ({
  uniqServiceBinding: uniqueIndex("idx_service_bindings_service_binding").on(
    table.serviceId,
    table.bindingName,
  ),
  idxService: index("idx_service_bindings_service_id").on(table.serviceId),
  idxResource: index("idx_service_bindings_resource_id").on(table.resourceId),
}));

export const serviceCommonEnvLinks = sqliteTable("service_common_env_links", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  serviceId: text("service_id").notNull().references(() => servicesTable.id),
  envName: text("env_name").notNull(),
  source: text("source").notNull().default("manual"),
  lastAppliedFingerprint: text("last_applied_fingerprint"),
  syncState: text("sync_state").notNull().default("pending"),
  syncReason: text("sync_reason"),
  lastObservedFingerprint: text("last_observed_fingerprint"),
  lastReconciledAt: text("last_reconciled_at"),
  lastSyncError: text("last_sync_error"),
  stateUpdatedAt: text("state_updated_at").notNull().$defaultFn(() =>
    new Date().toISOString()
  ),
  ...timestamps,
}, (table) => ({
  uniqServiceEnvSource: uniqueIndex(
    "idx_service_common_env_links_service_env_source",
  ).on(
    table.serviceId,
    table.envName,
    table.source,
  ),
  idxService: index("idx_service_common_env_links_service_id").on(
    table.serviceId,
  ),
  idxSyncState: index("idx_service_common_env_links_sync_state").on(
    table.syncState,
  ),
  idxAccount: index("idx_service_common_env_links_account_id").on(
    table.accountId,
  ),
  idxAccountEnv: index("idx_service_common_env_links_account_env").on(
    table.accountId,
    table.envName,
  ),
}));

export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  groupId: text("group_id"),
  ownerServiceId: text("owner_service_id").references(() => servicesTable.id),
  sourceType: text("source_type").notNull().default("api"),
  name: text("name").notNull(),
  catalogName: text("catalog_name"),
  publicationType: text("publication_type").notNull(),
  specJson: text("spec_json").notNull(),
  resolvedJson: text("resolved_json").notNull().default("{}"),
  status: text("status").notNull().default("active"),
  ...timestamps,
}, (table) => ({
  uniqAccountGlobalName: uniqueIndex(
    "idx_publications_account_global_name",
  ).on(
    table.accountId,
    table.name,
  ).where(sql`${table.groupId} IS NULL`),
  uniqAccountGroupName: uniqueIndex("idx_publications_account_group_name").on(
    table.accountId,
    table.groupId,
    table.name,
  ).where(sql`${table.groupId} IS NOT NULL`),
  idxAccountName: index("idx_publications_account_name").on(
    table.accountId,
    table.name,
  ),
  idxAccount: index("idx_publications_account_id").on(table.accountId),
  idxGroup: index("idx_publications_group_id").on(table.groupId),
  idxOwnerService: index("idx_publications_owner_service_id").on(
    table.ownerServiceId,
  ),
  idxAccountType: index("idx_publications_account_type").on(
    table.accountId,
    table.publicationType,
  ),
}));

export const serviceConsumes = sqliteTable("service_consumes", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  serviceId: text("service_id").notNull().references(() => servicesTable.id),
  publicationName: text("publication_name").notNull(),
  configJson: text("config_json").notNull().default("{}"),
  stateJson: text("state_json").notNull().default("{}"),
  ...timestamps,
}, (table) => ({
  uniqServicePublication: uniqueIndex("idx_service_consumes_service_name")
    .on(
      table.serviceId,
      table.publicationName,
    ),
  idxService: index("idx_service_consumes_service_id").on(table.serviceId),
  idxAccount: index("idx_service_consumes_account_id").on(table.accountId),
  idxAccountPublication: index("idx_service_consumes_account_publication").on(
    table.accountId,
    table.publicationName,
  ),
}));

export const physicalServices = servicesTable;
export const physicalServiceBindings = serviceBindings;
export const physicalServiceCommonEnvLinks = serviceCommonEnvLinks;
