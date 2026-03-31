import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps } from './schema-utils.ts';

// 35. Edge
export const edges = sqliteTable('edges', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  type: text('type').notNull(),
  weight: real('weight').notNull().default(1.0),
  metadata: text('metadata').notNull().default('{}'),
  ...createdAtColumn,
}, (table) => ({
  idxType: index('idx_edges_type').on(table.type),
  idxTarget: index('idx_edges_target_id').on(table.targetId),
  idxSource: index('idx_edges_source_id').on(table.sourceId),
  idxAccount: index('idx_edges_account_id').on(table.accountId),
}));

// 36. FileHandlerMatcher
export const fileHandlerMatchers = sqliteTable('file_handler_matchers', {
  fileHandlerId: text('file_handler_id').notNull(),
  kind: text('kind').notNull(),
  value: text('value').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.fileHandlerId, table.kind, table.value] }),
}));

// 37. FileHandler
const fileHandlersTable = sqliteTable('file_handlers', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  bundleDeploymentId: text('bundle_deployment_id').notNull(),
  serviceHostname: text('service_hostname').notNull(),
  name: text('name').notNull(),
  openPath: text('open_path').notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxAccount: index('idx_file_handlers_account_id').on(table.accountId),
}));

export const fileHandlers = Object.assign(fileHandlersTable, {
  workerHostname: fileHandlersTable.serviceHostname,
});

// 43. InfraEndpointRoute
export const infraEndpointRoutes = sqliteTable('infra_endpoint_routes', {
  endpointId: text('endpoint_id').notNull(),
  pathPrefix: text('path_prefix'),
  methodsJson: text('methods_json'),
  position: integer('position').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.endpointId, table.position] }),
}));

// 44. InfraEndpoint
export const infraEndpoints = sqliteTable('infra_endpoints', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  protocol: text('protocol').notNull().default('http'),
  targetServiceRef: text('target_service_ref').notNull(),
  timeoutMs: integer('timeout_ms'),
  bundleDeploymentId: text('bundle_deployment_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  uniqAccountName: uniqueIndex('idx_infra_endpoints_account_name').on(table.accountId, table.name),
  idxBundleDeployment: index('idx_infra_endpoints_bundle_deployment_id').on(table.bundleDeploymentId),
  idxAccount: index('idx_infra_endpoints_account_id').on(table.accountId),
}));

export const serviceEndpoints = infraEndpoints;

// 45. ServiceRuntime
const serviceRuntimesTable = sqliteTable('service_runtimes', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  runtime: text('runtime').notNull().default('cloudflare.worker'),
  cloudflareServiceRef: text('cloudflare_service_ref'),
  bundleDeploymentId: text('bundle_deployment_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  uniqAccountName: uniqueIndex('idx_service_runtimes_account_name').on(table.accountId, table.name),
  idxBundleDeployment: index('idx_service_runtimes_bundle_deployment_id').on(table.bundleDeploymentId),
  idxAccount: index('idx_service_runtimes_account_id').on(table.accountId),
}));

export const serviceRuntimes = serviceRuntimesTable;
export const infraWorkers = serviceRuntimesTable;

// 55. Node
export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  type: text('type').notNull(),
  refId: text('ref_id').notNull(),
  label: text('label'),
  metadata: text('metadata').notNull().default('{}'),
  ...createdAtColumn,
}, (table) => ({
  idxType: index('idx_nodes_type').on(table.type),
  idxRefId: index('idx_nodes_ref_id').on(table.refId),
  idxAccount: index('idx_nodes_account_id').on(table.accountId),
}));

// 89. ShortcutGroupItem
const shortcutGroupItemsTable = sqliteTable('shortcut_group_items', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  type: text('type').notNull(),
  label: text('label').notNull(),
  icon: text('icon'),
  position: integer('position').notNull().default(0),
  serviceId: text('service_id'),
  uiPath: text('ui_path'),
  resourceId: text('resource_id'),
  url: text('url'),
}, (table) => ({
  idxGroup: index('idx_shortcut_group_items_group_id').on(table.groupId),
}));

export const shortcutGroupItems = Object.assign(shortcutGroupItemsTable, {
  workerId: shortcutGroupItemsTable.serviceId,
});

// 90. ShortcutGroup
export const shortcutGroups = sqliteTable('shortcut_groups', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  icon: text('icon'),
  bundleDeploymentId: text('bundle_deployment_id'),
  ...timestamps,
}, (table) => ({
  idxAccount: index('idx_shortcut_groups_account_id').on(table.accountId),
}));

// 91. Shortcut
export const shortcuts = sqliteTable('shortcuts', {
  id: text('id').primaryKey(),
  userAccountId: text('user_account_id').notNull(),
  accountId: text('account_id').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  name: text('name').notNull(),
  icon: text('icon'),
  position: integer('position').notNull().default(0),
  ...timestamps,
}, (table) => ({
  uniqUserResourceTypeId: uniqueIndex('idx_shortcuts_user_resource_type_id').on(table.userAccountId, table.resourceType, table.resourceId),
  idxUser: index('idx_shortcuts_user_account_id').on(table.userAccountId),
  idxResourceTypeId: index('idx_shortcuts_resource_type_id').on(table.resourceType, table.resourceId),
  idxAccount: index('idx_shortcuts_account_id').on(table.accountId),
}));

// 97. UIExtension
export const uiExtensions = sqliteTable('ui_extensions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  path: text('path').notNull(),
  label: text('label').notNull(),
  icon: text('icon'),
  bundleR2Key: text('bundle_r2_key').notNull(),
  sidebarJson: text('sidebar_json'),
  bundleDeploymentId: text('bundle_deployment_id'),
  ...createdAtColumn,
}, (table) => ({
  uniqAccountPath: uniqueIndex('idx_ui_extensions_account_path').on(table.accountId, table.path),
  idxAccount: index('idx_ui_extensions_account_id').on(table.accountId),
}));
