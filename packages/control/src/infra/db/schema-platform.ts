import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps } from './schema-helpers';

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

// 54. ModerationAuditLog
export const moderationAuditLogs = sqliteTable('moderation_audit_logs', {
  id: text('id').primaryKey(),
  actorAccountId: text('actor_account_id'),
  reportId: text('report_id'),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  targetLabel: text('target_label'),
  actionType: text('action_type').notNull(),
  reason: text('reason'),
  details: text('details').notNull().default('{}'),
  ...createdAtColumn,
}, (table) => ({
  idxTargetTypeId: index('idx_moderation_audit_logs_target_type_id').on(table.targetType, table.targetId),
  idxReport: index('idx_moderation_audit_logs_report_id').on(table.reportId),
  idxCreatedAt: index('idx_moderation_audit_logs_created_at').on(table.createdAt),
  idxActor: index('idx_moderation_audit_logs_actor_account_id').on(table.actorAccountId),
  idxActionType: index('idx_moderation_audit_logs_action_type').on(table.actionType),
}));

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

// 56. NotificationPreference
export const notificationPreferences = sqliteTable('notification_preferences', {
  accountId: text('account_id').notNull(),
  type: text('type').notNull(),
  channel: text('channel').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, (table) => ({
  pk: primaryKey({ columns: [table.accountId, table.type, table.channel] }),
  idxType: index('idx_notification_preferences_type').on(table.type),
  idxChannel: index('idx_notification_preferences_channel').on(table.channel),
  idxAccount: index('idx_notification_preferences_account_id').on(table.accountId),
}));

// 57. NotificationSettings
export const notificationSettings = sqliteTable('notification_settings', {
  accountId: text('account_id').primaryKey(),
  mutedUntil: text('muted_until'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
});

// 58. Notification
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  recipientAccountId: text('recipient_account_id').notNull(),
  accountId: text('account_id'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  data: text('data').notNull().default('{}'),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  emailStatus: text('email_status').notNull().default('skipped'),
  emailAttempts: integer('email_attempts').notNull().default(0),
  emailSentAt: text('email_sent_at'),
  emailError: text('email_error'),
}, (table) => ({
  idxType: index('idx_notifications_type').on(table.type),
  idxRecipientReadAt: index('idx_notifications_recipient_read_at').on(table.recipientAccountId, table.readAt),
  idxRecipient: index('idx_notifications_recipient_account_id').on(table.recipientAccountId),
  idxRecipientCreatedAt: index('idx_notifications_recipient_created_at').on(table.recipientAccountId, table.createdAt),
  idxAccount: index('idx_notifications_account_id').on(table.accountId),
}));

// 78. Report
export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  reporterAccountId: text('reporter_account_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  targetLabel: text('target_label'),
  category: text('category').notNull(),
  description: text('description'),
  evidence: text('evidence').notNull().default('{}'),
  status: text('status').notNull().default('open'),
  autoFlagged: integer('auto_flagged', { mode: 'boolean' }).notNull().default(false),
  internalNotes: text('internal_notes'),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, (table) => ({
  idxTargetTypeId: index('idx_reports_target_type_id').on(table.targetType, table.targetId),
  idxStatus: index('idx_reports_status').on(table.status),
  idxReporter: index('idx_reports_reporter_account_id').on(table.reporterAccountId),
  idxCreatedAt: index('idx_reports_created_at').on(table.createdAt),
  idxCategory: index('idx_reports_category').on(table.category),
  idxAutoFlagged: index('idx_reports_auto_flagged').on(table.autoFlagged),
}));

// 80. ResourceAccess
export const resourceAccess = sqliteTable('resource_access', {
  id: text('id').primaryKey(),
  resourceId: text('resource_id').notNull(),
  accountId: text('account_id').notNull(),
  permission: text('permission').notNull().default('read'),
  grantedByAccountId: text('granted_by_account_id'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  uniqResourceAccount: uniqueIndex('idx_resource_access_resource_account').on(table.resourceId, table.accountId),
  idxResource: index('idx_resource_access_resource_id').on(table.resourceId),
  idxAccount: index('idx_resource_access_account_id').on(table.accountId),
}));

// 81. ResourceAccessToken
export const resourceAccessTokens = sqliteTable('resource_access_tokens', {
  id: text('id').primaryKey(),
  resourceId: text('resource_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  permission: text('permission').notNull().default('read'),
  expiresAt: text('expires_at'),
  lastUsedAt: text('last_used_at'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  idxTokenHash: index('idx_resource_access_tokens_token_hash').on(table.tokenHash),
  idxResource: index('idx_resource_access_tokens_resource_id').on(table.resourceId),
}));

// 82. Resource
export const resources = sqliteTable('resources', {
  id: text('id').primaryKey(),
  ownerAccountId: text('owner_account_id').notNull(),
  accountId: text('account_id'),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('provisioning'),
  cfId: text('cf_id'),
  cfName: text('cf_name'),
  config: text('config').notNull().default('{}'),
  metadata: text('metadata').notNull().default('{}'),
  sizeBytes: integer('size_bytes').default(0),
  itemCount: integer('item_count').default(0),
  lastUsedAt: text('last_used_at'),
  manifestKey: text('manifest_key'),
  orphanedAt: text('orphaned_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, (table) => ({
  idxType: index('idx_resources_type').on(table.type),
  idxStatus: index('idx_resources_status').on(table.status),
  idxOwner: index('idx_resources_owner_account_id').on(table.ownerAccountId),
  idxCfId: index('idx_resources_cf_id').on(table.cfId),
  idxAccount: index('idx_resources_account_id').on(table.accountId),
  idxManifestKey: index('idx_resources_manifest_key').on(table.manifestKey),
  idxOrphanedAt: index('idx_resources_orphaned_at').on(table.orphanedAt),
}));

// 86. SessionFile
export const sessionFiles = sqliteTable('session_files', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  path: text('path').notNull(),
  hash: text('hash').notNull(),
  size: integer('size').notNull().default(0),
  operation: text('operation').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  uniqSessionPath: uniqueIndex('idx_session_files_session_path').on(table.sessionId, table.path),
  idxSession: index('idx_session_files_session_id').on(table.sessionId),
}));

// 87. SessionRepo
export const sessionRepos = sqliteTable('session_repos', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  repoId: text('repo_id').notNull(),
  branch: text('branch'),
  mountPath: text('mount_path').notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  uniqSessionRepo: uniqueIndex('idx_session_repos_session_repo').on(table.sessionId, table.repoId),
  uniqSessionMount: uniqueIndex('idx_session_repos_session_mount').on(table.sessionId, table.mountPath),
  idxSessionPrimary: index('idx_session_repos_session_primary').on(table.sessionId, table.isPrimary),
  idxSession: index('idx_session_repos_session_id').on(table.sessionId),
  idxRepo: index('idx_session_repos_repo_id').on(table.repoId),
}));

// 88. Session
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  userAccountId: text('user_account_id'),
  baseSnapshotId: text('base_snapshot_id').notNull(),
  headSnapshotId: text('head_snapshot_id'),
  status: text('status').notNull(),
  lastHeartbeat: text('last_heartbeat'),
  repoId: text('repo_id'),
  branch: text('branch'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, (table) => ({
  idxUserAccount: index('idx_sessions_user_account_id').on(table.userAccountId),
  idxStatus: index('idx_sessions_status').on(table.status),
  idxRepo: index('idx_sessions_repo_id').on(table.repoId),
  idxLastHeartbeat: index('idx_sessions_last_heartbeat').on(table.lastHeartbeat),
  idxAccount: index('idx_sessions_account_id').on(table.accountId),
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
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
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
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
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
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  uniqAccountPath: uniqueIndex('idx_ui_extensions_account_path').on(table.accountId, table.path),
  idxAccount: index('idx_ui_extensions_account_id').on(table.accountId),
}));

// 114. DlqEntry
export const dlqEntries = sqliteTable('dlq_entries', {
  id: text('id').primaryKey(),
  queue: text('queue').notNull(),
  messageBody: text('message_body'),
  error: text('error'),
  retryCount: integer('retry_count'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

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
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
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
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  idxRegistry: index('idx_store_registry_updates_registry').on(table.registryEntryId),
  idxAccount: index('idx_store_registry_updates_account').on(table.accountId),
  uniqActivity: uniqueIndex('idx_store_registry_updates_activity').on(table.registryEntryId, table.activityId),
  idxSeen: index('idx_store_registry_updates_seen').on(table.accountId, table.seen),
}));
