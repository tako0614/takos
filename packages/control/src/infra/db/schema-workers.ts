import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAtColumn, timestamps } from "./schema-utils.ts";
import {
  serviceBindings,
  serviceCommonEnvLinks,
  services,
} from "./schema-services.ts";
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

// 14. App
const appsTable = sqliteTable("apps", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  serviceId: text("service_id").references(() => services.id),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  appType: text("app_type").notNull(),
  takosClientKey: text("takos_client_key"),
  ...timestamps,
}, (table) => ({
  idxService: index("idx_apps_service_id").on(table.serviceId),
  idxAppType: index("idx_apps_app_type").on(table.appType),
  idxAccount: index("idx_apps_account_id").on(table.accountId),
}));

export const apps = Object.assign(appsTable, {
  workerId: appsTable.serviceId,
});

// 26. BundleDeploymentEvent
export const bundleDeploymentEvents = sqliteTable("bundle_deployment_events", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  bundleDeploymentId: text("bundle_deployment_id"),
  name: text("name").notNull(),
  appId: text("app_id").notNull(),
  bundleKey: text("bundle_key").notNull(),
  version: text("version").notNull(),
  deployAction: text("deploy_action").notNull(),
  deployedAt: text("deployed_at").notNull().$defaultFn(() =>
    new Date().toISOString()
  ),
  deployedByAccountId: text("deployed_by_account_id").notNull(),
  sourceType: text("source_type"),
  sourceRepoId: text("source_repo_id"),
  sourceTag: text("source_tag"),
  sourceAssetId: text("source_asset_id"),
  replacedBundleDeploymentId: text("replaced_bundle_deployment_id"),
}, (table) => ({
  idxSourceRepo: index("idx_bundle_deployment_events_source_repo_id").on(
    table.sourceRepoId,
  ),
  idxBundleKey: index("idx_bundle_deployment_events_bundle_key").on(
    table.bundleKey,
  ),
  idxBundleDeployment: index(
    "idx_bundle_deployment_events_bundle_deployment_id",
  ).on(table.bundleDeploymentId),
  idxAccountNameDeployed: index(
    "idx_bundle_deployment_events_account_name_deployed",
  ).on(table.accountId, table.name, table.deployedAt),
  idxAccount: index("idx_bundle_deployment_events_account_id").on(
    table.accountId,
  ),
}));

// 27. BundleDeployment
export const bundleDeployments = sqliteTable("bundle_deployments", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  name: text("name").notNull(),
  appId: text("app_id").notNull(),
  bundleKey: text("bundle_key").notNull(),
  version: text("version").notNull(),
  versionMajor: integer("version_major").notNull().default(0),
  versionMinor: integer("version_minor").notNull().default(0),
  versionPatch: integer("version_patch").notNull().default(0),
  description: text("description"),
  icon: text("icon"),
  manifestJson: text("manifest_json").notNull(),
  deployedAt: text("deployed_at").notNull().$defaultFn(() =>
    new Date().toISOString()
  ),
  deployedByAccountId: text("deployed_by_account_id").notNull(),
  sourceType: text("source_type"),
  sourceRepoId: text("source_repo_id"),
  sourceTag: text("source_tag"),
  sourceAssetId: text("source_asset_id"),
  oauthClientId: text("oauth_client_id"),
  rolloutState: text("rollout_state"),
  isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
  lockedAt: text("locked_at"),
  lockedByAccountId: text("locked_by_account_id"),
}, (table) => ({
  uniqAccountName: uniqueIndex("idx_bundle_deployments_account_name").on(
    table.accountId,
    table.name,
  ),
  uniqAccountApp: uniqueIndex("idx_bundle_deployments_account_app").on(
    table.accountId,
    table.appId,
  ),
  idxSourceRepo: index("idx_bundle_deployments_source_repo_id").on(
    table.sourceRepoId,
  ),
  idxBundleKey: index("idx_bundle_deployments_bundle_key").on(table.bundleKey),
  idxAccount: index("idx_bundle_deployments_account_id").on(table.accountId),
}));

// 30. CommonEnvAuditLog
const commonEnvAuditLogsTable = sqliteTable("common_env_audit_logs", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  actorAccountId: text("actor_account_id").references(() => accounts.id),
  actorType: text("actor_type").notNull(),
  eventType: text("event_type").notNull(),
  envName: text("env_name").notNull(),
  serviceId: text("service_id").references(() => services.id),
  linkSource: text("link_source"),
  changeBefore: text("change_before").notNull().default("{}"),
  changeAfter: text("change_after").notNull().default("{}"),
  requestId: text("request_id"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  ...createdAtColumn,
}, (table) => ({
  idxServiceCreatedAt: index("idx_common_env_audit_logs_service_created_at").on(
    table.serviceId,
    table.createdAt,
  ),
  idxAccountEnvCreatedAt: index(
    "idx_common_env_audit_logs_account_env_created_at",
  ).on(table.accountId, table.envName, table.createdAt),
  idxAccountCreatedAt: index("idx_common_env_audit_logs_account_created_at").on(
    table.accountId,
    table.createdAt,
  ),
}));

export const commonEnvAuditLogs = Object.assign(commonEnvAuditLogsTable, {
  workerId: commonEnvAuditLogsTable.serviceId,
});

export const serviceCommonEnvAuditLogs = commonEnvAuditLogs;

// 31. CommonEnvReconcileJob
const commonEnvReconcileJobsTable = sqliteTable("common_env_reconcile_jobs", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  serviceId: text("service_id").notNull().references(() => services.id),
  targetKeysJson: text("target_keys_json"),
  trigger: text("trigger").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: text("next_attempt_at"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  enqueuedAt: text("enqueued_at"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => ({
  idxStatusNextAttempt: index(
    "idx_common_env_reconcile_jobs_status_next_attempt",
  ).on(table.status, table.nextAttemptAt),
  idxAccountServiceStatus: index(
    "idx_common_env_reconcile_jobs_account_service_status",
  ).on(table.accountId, table.serviceId, table.status),
  idxAccountStatus: index("idx_common_env_reconcile_jobs_account_status").on(
    table.accountId,
    table.status,
  ),
}));

export const commonEnvReconcileJobs = Object.assign(
  commonEnvReconcileJobsTable,
  {
    workerId: commonEnvReconcileJobsTable.serviceId,
  },
);

export const serviceCommonEnvReconcileJobs = commonEnvReconcileJobs;

// 32. CustomDomain
const customDomainsTable = sqliteTable("custom_domains", {
  id: text("id").primaryKey(),
  serviceId: text("service_id").notNull().references(() => services.id),
  domain: text("domain").notNull().unique(),
  status: text("status").notNull().default("pending"),
  verificationToken: text("verification_token").notNull(),
  verificationMethod: text("verification_method").notNull().default("cname"),
  cfCustomHostnameId: text("cf_custom_hostname_id"),
  sslStatus: text("ssl_status").default("pending"),
  verifiedAt: text("verified_at"),
  ...timestamps,
}, (table) => ({
  idxService: index("idx_custom_domains_service_id").on(table.serviceId),
  idxStatus: index("idx_custom_domains_status").on(table.status),
  idxDomain: index("idx_custom_domains_domain").on(table.domain),
}));

export const customDomains = Object.assign(customDomainsTable, {
  workerId: customDomainsTable.serviceId,
});

export const serviceCustomDomains = customDomains;

// 33. DeploymentEvent
export const deploymentEvents = sqliteTable("deployment_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deploymentId: text("deployment_id").notNull().references(() =>
    deploymentTable.id
  ),
  actorAccountId: text("actor_account_id").references(() => accounts.id),
  eventType: text("event_type").notNull(),
  stepName: text("step_name"),
  message: text("message"),
  details: text("details"),
  ...createdAtColumn,
}, (table) => ({
  idxEventType: index("idx_deployment_events_event_type").on(table.eventType),
  idxDeployment: index("idx_deployment_events_deployment_id").on(
    table.deploymentId,
  ),
  idxActor: index("idx_deployment_events_actor_account_id").on(
    table.actorAccountId,
  ),
}));

// 34. Deployment
const deploymentTable = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  serviceId: text("service_id").notNull().references(() => services.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  version: integer("version").notNull(),
  artifactRef: text("artifact_ref"),
  bundleR2Key: text("bundle_r2_key"),
  bundleHash: text("bundle_hash"),
  bundleSize: integer("bundle_size"),
  wasmR2Key: text("wasm_r2_key"),
  wasmHash: text("wasm_hash"),
  assetsManifest: text("assets_manifest"),
  runtimeConfigSnapshotJson: text("runtime_config_snapshot_json").notNull()
    .default("{}"),
  bindingsSnapshotEncrypted: text("bindings_snapshot_encrypted"),
  envVarsSnapshotEncrypted: text("env_vars_snapshot_encrypted"),
  deployState: text("deploy_state").notNull().default("pending"),
  currentStep: text("current_step"),
  stepError: text("step_error"),
  status: text("status").notNull().default("pending"),
  routingStatus: text("routing_status").notNull().default("archived"),
  routingWeight: integer("routing_weight").notNull().default(0),
  deployedBy: text("deployed_by"),
  deployMessage: text("deploy_message"),
  backendName: text("backend_name").notNull().default("workers-dispatch"),
  targetJson: text("target_json").notNull().default("{}"),
  backendStateJson: text("backend_state_json").notNull().default("{}"),
  artifactKind: text("artifact_kind").notNull().default("worker-bundle"),
  idempotencyKey: text("idempotency_key").unique(),
  isRollback: integer("is_rollback", { mode: "boolean" }).notNull().default(
    false,
  ),
  rollbackFromVersion: integer("rollback_from_version"),
  rolledBackAt: text("rolled_back_at"),
  rolledBackBy: text("rolled_back_by"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => ({
  uniqServiceVersion: uniqueIndex("idx_deployments_service_version").on(
    table.serviceId,
    table.version,
  ),
  idxServiceRouting: index("idx_deployments_service_routing_status").on(
    table.serviceId,
    table.routingStatus,
  ),
  idxService: index("idx_deployments_service_id").on(table.serviceId),
  // NOTE (Round 11 audit Finding #9): baseline migration 0001 creates
  // `deployments_worker_id_created_at_idx` with DESC order
  // (`created_at DESC`). Drizzle cannot express column-level ASC/DESC
  // inside `index()`, so the physical order is determined by the
  // migration, not this declaration.
  idxServiceCreatedAt: index("idx_deployments_service_created_at").on(
    table.serviceId,
    table.createdAt,
  ),
  idxStatus: index("idx_deployments_status").on(table.status),
  idxAccountStatus: index("idx_deployments_account_status").on(
    table.accountId,
    table.status,
  ),
  idxAccount: index("idx_deployments_account_id").on(table.accountId),
}));

export const deployments = Object.assign(deploymentTable, {
  workerId: deploymentTable.serviceId,
});

export const serviceDeployments = deployments;

// 49. ManagedTakosToken
const managedTakosTokensTable = sqliteTable("managed_takos_tokens", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  serviceId: text("service_id").notNull().references(() => services.id),
  envName: text("env_name").notNull(),
  subjectAccountId: text("subject_account_id").notNull(),
  subjectMode: text("subject_mode").notNull(),
  scopesJson: text("scopes_json").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  lastUsedAt: text("last_used_at"),
  ...timestamps,
}, (table) => ({
  uniqServiceEnv: uniqueIndex("idx_managed_takos_tokens_service_env").on(
    table.serviceId,
    table.envName,
  ),
  idxService: index("idx_managed_takos_tokens_service_id").on(table.serviceId),
  idxSubject: index("idx_managed_takos_tokens_subject_account_id").on(
    table.subjectAccountId,
  ),
  idxAccountEnv: index("idx_managed_takos_tokens_account_env").on(
    table.accountId,
    table.envName,
  ),
}));

export const managedTakosTokens = Object.assign(managedTakosTokensTable, {
  workerId: managedTakosTokensTable.serviceId,
});

export const serviceManagedTakosTokens = managedTakosTokens;

// 100. WorkerBinding (compat alias to services-centric schema)
export const workerBindings = Object.assign(serviceBindings, {
  workerId: serviceBindings.serviceId,
});

// 101. WorkerCommonEnvLink (compat alias to services-centric schema)
export const workerCommonEnvLinks = Object.assign(serviceCommonEnvLinks, {
  workerId: serviceCommonEnvLinks.serviceId,
});

// 102. ServiceEnvVar
const serviceEnvVarsTable = sqliteTable("service_env_vars", {
  id: text("id").primaryKey(),
  serviceId: text("service_id").notNull().references(() => services.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  name: text("name").notNull(),
  valueEncrypted: text("value_encrypted").notNull(),
  isSecret: integer("is_secret", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => ({
  uniqServiceName: uniqueIndex("idx_service_env_vars_service_name").on(
    table.serviceId,
    table.name,
  ),
  idxService: index("idx_service_env_vars_service_id").on(table.serviceId),
  idxAccount: index("idx_service_env_vars_account_id").on(table.accountId),
}));

export const serviceEnvVars = serviceEnvVarsTable;

export const workerEnvVars = Object.assign(serviceEnvVarsTable, {
  workerId: serviceEnvVarsTable.serviceId,
});

// 103. ServiceMcpEndpoint
const serviceMcpEndpointsTable = sqliteTable("service_mcp_endpoints", {
  serviceId: text("service_id").notNull().references(() => services.id),
  name: text("name").notNull(),
  path: text("path").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
}, (table) => ({
  pk: primaryKey({ columns: [table.serviceId, table.name] }),
}));

export const serviceMcpEndpoints = serviceMcpEndpointsTable;

export const workerMcpEndpoints = Object.assign(serviceMcpEndpointsTable, {
  workerId: serviceMcpEndpointsTable.serviceId,
});

// 104. ServiceRuntimeFlag
const serviceRuntimeFlagsTable = sqliteTable("service_runtime_flags", {
  serviceId: text("service_id").notNull().references(() => services.id),
  flag: text("flag").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.serviceId, table.flag] }),
}));

export const serviceRuntimeFlags = serviceRuntimeFlagsTable;

export const workerRuntimeFlags = Object.assign(serviceRuntimeFlagsTable, {
  workerId: serviceRuntimeFlagsTable.serviceId,
});

// 105. ServiceRuntimeLimit
const serviceRuntimeLimitsTable = sqliteTable("service_runtime_limits", {
  serviceId: text("service_id").primaryKey().references(() => services.id),
  cpuMs: integer("cpu_ms"),
  memoryMb: integer("memory_mb"),
  subrequestLimit: integer("subrequest_limit"),
});

export const serviceRuntimeLimits = serviceRuntimeLimitsTable;

export const workerRuntimeLimits = Object.assign(serviceRuntimeLimitsTable, {
  workerId: serviceRuntimeLimitsTable.serviceId,
});

// 106. ServiceRuntimeSetting
const serviceRuntimeSettingsTable = sqliteTable("service_runtime_settings", {
  serviceId: text("service_id").primaryKey().references(() => services.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  compatibilityDate: text("compatibility_date"),
  ...timestamps,
}, (table) => ({
  idxAccount: index("idx_service_runtime_settings_account_id").on(
    table.accountId,
  ),
}));

export const serviceRuntimeSettings = serviceRuntimeSettingsTable;

export const workerRuntimeSettings = Object.assign(
  serviceRuntimeSettingsTable,
  {
    workerId: serviceRuntimeSettingsTable.serviceId,
  },
);

// 107. Worker (compat alias to services-centric schema)
export const workers = services;
