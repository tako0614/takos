import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps } from './schema-utils';

const servicesTable = sqliteTable('services', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  serviceType: text('service_type').notNull().default('app'),
  nameType: text('name_type'),
  status: text('status').notNull().default('pending'),
  config: text('config'),
  hostname: text('hostname').unique(),
  routeRef: text('route_ref').unique(),
  slug: text('slug').unique(),
  activeDeploymentId: text('active_deployment_id'),
  fallbackDeploymentId: text('fallback_deployment_id'),
  currentVersion: integer('current_version').notNull().default(0),
  workloadKind: text('workload_kind'),
  ...timestamps,
}, (table) => ({
  uniqIdAccount: uniqueIndex('idx_services_id_account').on(table.id, table.accountId),
  idxStatus: index('idx_services_status').on(table.status),
  idxHostname: index('idx_services_hostname').on(table.hostname),
  idxAccountStatus: index('idx_services_account_status').on(table.accountId, table.status),
  idxAccount: index('idx_services_account_id').on(table.accountId),
}));

export const services = Object.assign(servicesTable, {
  workerType: servicesTable.serviceType,
});

export const serviceBindings = sqliteTable('service_bindings', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  resourceId: text('resource_id').notNull(),
  bindingName: text('binding_name').notNull(),
  bindingType: text('binding_type').notNull(),
  config: text('config').notNull().default('{}'),
  ...createdAtColumn,
}, (table) => ({
  uniqServiceBinding: uniqueIndex('idx_service_bindings_service_binding').on(table.serviceId, table.bindingName),
  idxService: index('idx_service_bindings_service_id').on(table.serviceId),
  idxResource: index('idx_service_bindings_resource_id').on(table.resourceId),
}));

export const serviceCommonEnvLinks = sqliteTable('service_common_env_links', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  serviceId: text('service_id').notNull(),
  envName: text('env_name').notNull(),
  source: text('source').notNull().default('manual'),
  lastAppliedFingerprint: text('last_applied_fingerprint'),
  syncState: text('sync_state').notNull().default('pending'),
  syncReason: text('sync_reason'),
  lastObservedFingerprint: text('last_observed_fingerprint'),
  lastReconciledAt: text('last_reconciled_at'),
  lastSyncError: text('last_sync_error'),
  stateUpdatedAt: text('state_updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  ...timestamps,
}, (table) => ({
  uniqServiceEnvSource: uniqueIndex('idx_service_common_env_links_service_env_source').on(
    table.serviceId,
    table.envName,
    table.source,
  ),
  idxService: index('idx_service_common_env_links_service_id').on(table.serviceId),
  idxSyncState: index('idx_service_common_env_links_sync_state').on(table.syncState),
  idxAccount: index('idx_service_common_env_links_account_id').on(table.accountId),
  idxAccountEnv: index('idx_service_common_env_links_account_env').on(table.accountId, table.envName),
}));

export const physicalServices = servicesTable;
export const physicalServiceBindings = serviceBindings;
export const physicalServiceCommonEnvLinks = serviceCommonEnvLinks;
