import { getTableName, getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

// ---- schema-accounts ----
import {
  accountBlocks,
  accountEnvVars,
  accountFollowRequests,
  accountFollows,
  accountMemberships,
  accountMetadata,
  accountModeration,
  accountMutes,
  accountSettings,
  accountStats,
  accountStorageFiles,
  accounts,
  authIdentities,
} from '@/db/schema-accounts';

// ---- schema-auth ----
import {
  authServices,
  authSessions,
  personalAccessTokens,
  serviceTokens,
} from '@/db/schema-auth';

// ---- schema-billing ----
import {
  billingAccounts,
  billingPlanFeatures,
  billingPlanQuotas,
  billingPlanRates,
  billingPlans,
  billingTransactions,
  usageEvents,
  usageRollups,
} from '@/db/schema-billing';

// ---- schema-agents ----
import {
  agentTasks,
  artifacts,
  infoUnits,
  lgCheckpoints,
  lgWrites,
  memories,
  messages,
  reminders,
  runEvents,
  runs,
  skills,
  threadShares,
  threads,
  toolOperations,
} from '@/db/schema-agents';

// ---- schema-repos ----
import {
  blobs,
  branches,
  chunks,
  commits,
  files,
  gitCommits,
  gitFileChanges,
  indexJobs,
  prComments,
  prReviews,
  pullRequests,
  repoForks,
  repoReleaseAssets,
  repoReleases,
  repoRemotes,
  repoStars,
  repositories,
  snapshots,
  tags,
} from '@/db/schema-repos';

// ---- schema-workers ----
import {
  apps,
  bundleDeploymentEvents,
  bundleDeployments,
  commonEnvAuditLogs,
  commonEnvReconcileJobs,
  customDomains,
  deploymentEvents,
  deployments,
  managedTakosTokens,
  serviceCommonEnvAuditLogs,
  serviceCommonEnvReconcileJobs,
  serviceCustomDomains,
  serviceEnvVars,
  serviceManagedTakosTokens,
  serviceMcpEndpoints,
  serviceRuntimeFlags,
  serviceRuntimeLimits,
  serviceRuntimeSettings,
  workerBindings,
  workerCommonEnvLinks,
  workerEnvVars,
  workerMcpEndpoints,
  workerRuntimeFlags,
  workerRuntimeLimits,
  workerRuntimeSettings,
  workers,
} from '@/db/schema-workers';

// ---- schema-oauth ----
import {
  mcpOauthPending,
  mcpServers,
  oauthAuditLogs,
  oauthAuthorizationCodes,
  oauthClients,
  oauthConsents,
  oauthDeviceCodes,
  oauthStates,
  oauthTokens,
} from '@/db/schema-oauth';

// ---- schema-platform ----
import {
  edges,
  fileHandlerMatchers,
  fileHandlers,
  infraEndpointRoutes,
  infraEndpoints,
  serviceRuntimes,
  moderationAuditLogs,
  nodes,
  notificationPreferences,
  notificationSettings,
  notifications,
  reports,
  resourceAccess,
  resourceAccessTokens,
  resources,
  sessionFiles,
  sessionRepos,
  sessions,
  shortcutGroupItems,
  shortcutGroups,
  shortcuts,
  uiExtensions,
  dlqEntries,
  storeRegistry,
  storeRegistryUpdates,
} from '@/db/schema-platform';

// ---- schema-workflows ----
import {
  workflowArtifacts,
  workflowJobs,
  workflowRuns,
  workflowSecrets,
  workflowSteps,
  workflows,
} from '@/db/schema-workflows';

// ---- schema-services ----
import {
  services,
  serviceBindings,
  serviceCommonEnvLinks,
} from '@/db/schema-services';

// ---- helpers ----
import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

const nowIso = () => new Date().toISOString();

// ===================================================================
// Helper: extract column names, index names, unique index names
// ===================================================================
function colNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.keys(getTableColumns(table));
}

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  const config = getTableConfig(table);
  return (config.indexes ?? []).map((i) => i.config.name);
}

function uniqueIndexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  const config = getTableConfig(table);
  return (config.indexes ?? [])
    .filter((i) => i.config.unique)
    .map((i) => i.config.name);
}

function primaryKeyNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  const config = getTableConfig(table);
  return (config.primaryKeys ?? []).map((pk) => {
    // Composite PKs have a name from the builder; single-column PKs may not
    return pk.getName?.() ?? 'pk';
  });
}

function hasColumn(table: Parameters<typeof getTableColumns>[0], name: string): boolean {
  return name in getTableColumns(table);
}

// ===================================================================
// Tests
// ===================================================================


  Deno.test('nowIso helper - returns an ISO-8601 formatted string', () => {
  const result = nowIso();
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(result));
})

  Deno.test('schema-services - defines physical services tables', () => {
  assertEquals(getTableName(services), 'services');
    assertEquals(getTableName(serviceBindings), 'service_bindings');
    assertEquals(getTableName(serviceCommonEnvLinks), 'service_common_env_links');
})
  Deno.test('schema-services - exposes worker compatibility aliases', () => {
  assertEquals(getTableName(workers), 'services');
    assertEquals(workerBindings.workerId, serviceBindings.serviceId);
    assertEquals(workerCommonEnvLinks.workerId, serviceCommonEnvLinks.serviceId);
})
// ===================================================================
// schema-accounts
// ===================================================================

  
    Deno.test('schema-accounts - accounts table - is named "accounts"', () => {
  assertEquals(getTableName(accounts), 'accounts');
})
    Deno.test('schema-accounts - accounts table - has all required columns', () => {
  const cols = colNames(accounts);
      const required = [
        'id', 'type', 'status', 'name', 'slug', 'description', 'picture',
        'bio', 'email', 'trustTier', 'setupCompleted', 'defaultRepositoryId',
        'headSnapshotId', 'aiModel', 'aiProvider', 'securityPosture',
        'ownerAccountId', 'createdAt', 'updatedAt',
      ];
      for (const col of required) {
        assertStringIncludes(cols, col);
      }
})
    Deno.test('schema-accounts - accounts table - has indexes for type, slug, owner, and email', () => {
  const idxs = indexNames(accounts);
      assertStringIncludes(idxs, 'idx_accounts_type');
      assertStringIncludes(idxs, 'idx_accounts_slug');
      assertStringIncludes(idxs, 'idx_accounts_owner_account_id');
      assertStringIncludes(idxs, 'idx_accounts_email');
})  
  
    Deno.test('schema-accounts - accountBlocks table - is named "account_blocks"', () => {
  assertEquals(getTableName(accountBlocks), 'account_blocks');
})
    Deno.test('schema-accounts - accountBlocks table - has composite primary key on blocker+blocked', () => {
  const pks = primaryKeyNames(accountBlocks);
      assert(pks.length >= 1);
})
    Deno.test('schema-accounts - accountBlocks table - has indexes on both blocker and blocked', () => {
  const idxs = indexNames(accountBlocks);
      assertStringIncludes(idxs, 'idx_account_blocks_blocker_account_id');
      assertStringIncludes(idxs, 'idx_account_blocks_blocked_account_id');
})  
  
    Deno.test('schema-accounts - accountEnvVars table - has a unique index on account_id + name', () => {
  const uniq = uniqueIndexNames(accountEnvVars);
      assertStringIncludes(uniq, 'idx_account_env_vars_account_id_name');
})
    Deno.test('schema-accounts - accountEnvVars table - includes isSecret boolean column', () => {
  assertEquals(hasColumn(accountEnvVars, 'isSecret'), true);
})  
  
    Deno.test('schema-accounts - accountFollowRequests table - has a unique constraint on requester+target', () => {
  const uniq = uniqueIndexNames(accountFollowRequests);
      assertStringIncludes(uniq, 'idx_account_follow_requests_requester_target');
})
    Deno.test('schema-accounts - accountFollowRequests table - has indexes for target+status, requester, and createdAt', () => {
  const idxs = indexNames(accountFollowRequests);
      assertStringIncludes(idxs, 'idx_account_follow_requests_target_status');
      assertStringIncludes(idxs, 'idx_account_follow_requests_requester');
      assertStringIncludes(idxs, 'idx_account_follow_requests_created_at');
})  
  
    Deno.test('schema-accounts - accountFollows table - has composite primary key on follower+following', () => {
  const pks = primaryKeyNames(accountFollows);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-accounts - accountMemberships table - has a unique index on account+member', () => {
  const uniq = uniqueIndexNames(accountMemberships);
      assertStringIncludes(uniq, 'idx_account_memberships_account_member');
})
    Deno.test('schema-accounts - accountMemberships table - defaults role to viewer and status to active', () => {
  const cols = getTableColumns(accountMemberships);
      assertEquals(cols.role.default, 'viewer');
      assertEquals(cols.status.default, 'active');
})  
  
    Deno.test('schema-accounts - accountMetadata table - has composite primary key on accountId+key', () => {
  const pks = primaryKeyNames(accountMetadata);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-accounts - accountModeration table - uses accountId as primary key', () => {
  const cols = getTableColumns(accountModeration);
      assertEquals(cols.accountId.primary, true);
})
    Deno.test('schema-accounts - accountModeration table - defaults status to active', () => {
  const cols = getTableColumns(accountModeration);
      assertEquals(cols.status.default, 'active');
})  
  
    Deno.test('schema-accounts - accountMutes table - has composite primary key on muter+muted', () => {
  const pks = primaryKeyNames(accountMutes);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-accounts - accountSettings table - is named "account_settings"', () => {
  assertEquals(getTableName(accountSettings), 'account_settings');
})
    Deno.test('schema-accounts - accountSettings table - has boolean columns with defaults', () => {
  const cols = getTableColumns(accountSettings);
      assertEquals(cols.setupCompleted.default, false);
      assertEquals(cols.autoUpdateEnabled.default, true);
      assertEquals(cols.privateAccount.default, false);
})  
  
    Deno.test('schema-accounts - accountStats table - has indexes on totalSizeBytes and fileCount', () => {
  const idxs = indexNames(accountStats);
      assertStringIncludes(idxs, 'idx_account_stats_total_size_bytes');
      assertStringIncludes(idxs, 'idx_account_stats_file_count');
})  
  
    Deno.test('schema-accounts - accountStorageFiles table - has unique index on accountId+path', () => {
  const uniq = uniqueIndexNames(accountStorageFiles);
      assertStringIncludes(uniq, 'idx_account_storage_files_account_path');
})  
  
    Deno.test('schema-accounts - authIdentities table - is named "auth_identities"', () => {
  assertEquals(getTableName(authIdentities), 'auth_identities');
})
    Deno.test('schema-accounts - authIdentities table - has a unique index on provider+providerSub', () => {
  const uniq = uniqueIndexNames(authIdentities);
      assertStringIncludes(uniq, 'idx_auth_identities_provider_sub');
})
    Deno.test('schema-accounts - authIdentities table - has a foreign key reference from userId to accounts.id', () => {
  const config = getTableConfig(authIdentities);
      const fks = config.foreignKeys ?? [];
      assert(fks.length >= 1);
})  
// ===================================================================
// schema-auth
// ===================================================================

  
    Deno.test('schema-auth - authServices table - is named "auth_services"', () => {
  assertEquals(getTableName(authServices), 'auth_services');
})
    Deno.test('schema-auth - authServices table - has indexes on domain and apiKeyHash', () => {
  const idxs = indexNames(authServices);
      assertStringIncludes(idxs, 'idx_auth_services_domain');
      assertStringIncludes(idxs, 'idx_auth_services_api_key_hash');
})  
  
    Deno.test('schema-auth - authSessions table - has indexes on tokenHash, expiresAt, and accountId', () => {
  const idxs = indexNames(authSessions);
      assertStringIncludes(idxs, 'idx_auth_sessions_token_hash');
      assertStringIncludes(idxs, 'idx_auth_sessions_expires_at');
      assertStringIncludes(idxs, 'idx_auth_sessions_account_id');
})  
  
    Deno.test('schema-auth - personalAccessTokens table - is named "personal_access_tokens"', () => {
  assertEquals(getTableName(personalAccessTokens), 'personal_access_tokens');
})
    Deno.test('schema-auth - personalAccessTokens table - defaults scopes to wildcard', () => {
  const cols = getTableColumns(personalAccessTokens);
      assertEquals(cols.scopes.default, '*');
})  
  
    Deno.test('schema-auth - serviceTokens table - is named "service_tokens"', () => {
  assertEquals(getTableName(serviceTokens), 'service_tokens');
})
    Deno.test('schema-auth - serviceTokens table - has an index on tokenHash', () => {
  const idxs = indexNames(serviceTokens);
      assertStringIncludes(idxs, 'idx_service_tokens_token_hash');
})  
// ===================================================================
// schema-billing
// ===================================================================

  
    Deno.test('schema-billing - billingAccounts table - is named "billing_accounts"', () => {
  assertEquals(getTableName(billingAccounts), 'billing_accounts');
})
    Deno.test('schema-billing - billingAccounts table - defaults balanceCents to 0 and status to active', () => {
  const cols = getTableColumns(billingAccounts);
      assertEquals(cols.balanceCents.default, 0);
      assertEquals(cols.status.default, 'active');
})  
  
    Deno.test('schema-billing - billingPlanFeatures table - has composite primary key on planId+featureKey', () => {
  const pks = primaryKeyNames(billingPlanFeatures);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-billing - billingPlanQuotas table - has composite primary key on planId+quotaKey', () => {
  const pks = primaryKeyNames(billingPlanQuotas);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-billing - billingPlanRates table - has composite primary key on planId+meterType', () => {
  const pks = primaryKeyNames(billingPlanRates);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-billing - billingPlans table - has indexes on name and isDefault', () => {
  const idxs = indexNames(billingPlans);
      assertStringIncludes(idxs, 'idx_billing_plans_name');
      assertStringIncludes(idxs, 'idx_billing_plans_is_default');
})  
  
    Deno.test('schema-billing - billingTransactions table - has columns for amountCents and balanceAfterCents', () => {
  assertEquals(hasColumn(billingTransactions, 'amountCents'), true);
      assertEquals(hasColumn(billingTransactions, 'balanceAfterCents'), true);
})  
  
    Deno.test('schema-billing - usageEvents table - has an idempotency key with unique constraint', () => {
  assertEquals(hasColumn(usageEvents, 'idempotencyKey'), true);
})
    Deno.test('schema-billing - usageEvents table - uses a real column for units', () => {
  assertEquals(hasColumn(usageEvents, 'units'), true);
})  
  
    Deno.test('schema-billing - usageRollups table - has a unique index on the billing scope composite', () => {
  const uniq = uniqueIndexNames(usageRollups);
      assertStringIncludes(uniq, 'idx_usage_rollups_billing_scope');
})  
// ===================================================================
// schema-agents
// ===================================================================

  
    Deno.test('schema-agents - agentTasks table - is named "agent_tasks"', () => {
  assertEquals(getTableName(agentTasks), 'agent_tasks');
})
    Deno.test('schema-agents - agentTasks table - defaults status to planned and priority to medium', () => {
  const cols = getTableColumns(agentTasks);
      assertEquals(cols.status.default, 'planned');
      assertEquals(cols.priority.default, 'medium');
})
    Deno.test('schema-agents - agentTasks table - has composite index on account+status', () => {
  const idxs = indexNames(agentTasks);
      assertStringIncludes(idxs, 'idx_agent_tasks_account_status');
})  
  
    Deno.test('schema-agents - messages table - is named "messages"', () => {
  assertEquals(getTableName(messages), 'messages');
})
    Deno.test('schema-agents - messages table - has required columns: id, threadId, role, content, sequence', () => {
  for (const col of ['id', 'threadId', 'role', 'content', 'sequence']) {
        assertEquals(hasColumn(messages, col), true);
      }
})
    Deno.test('schema-agents - messages table - has indexes for thread+sequence and thread+createdAt', () => {
  const idxs = indexNames(messages);
      assertStringIncludes(idxs, 'idx_messages_thread_sequence');
      assertStringIncludes(idxs, 'idx_messages_thread_created_at');
})  
  
    Deno.test('schema-agents - runs table - is named "runs"', () => {
  assertEquals(getTableName(runs), 'runs');
})
    Deno.test('schema-agents - runs table - defaults status to queued', () => {
  const cols = getTableColumns(runs);
      assertEquals(cols.status.default, 'queued');
      assertEquals(runs.serviceId, runs.workerId);
      assertEquals(runs.serviceHeartbeat, runs.workerHeartbeat);
      assertStringIncludes(indexNames(runs), 'idx_runs_service_id');
      assertStringIncludes(indexNames(runs), 'idx_runs_service_heartbeat');
})
    Deno.test('schema-agents - runs table - has subagent columns parentRunId, childThreadId, rootThreadId, rootRunId', () => {
  for (const col of ['parentRunId', 'childThreadId', 'rootThreadId', 'rootRunId']) {
        assertEquals(hasColumn(runs, col), true);
      }
})
    Deno.test('schema-agents - runs table - has a leaseVersion column for optimistic concurrency', () => {
  assertEquals(hasColumn(runs, 'leaseVersion'), true);
})  
  
    Deno.test('schema-agents - runEvents table - uses auto-increment integer primary key', () => {
  const cols = getTableColumns(runEvents);
      assertEquals(cols.id.primary, true);
})  
  
    Deno.test('schema-agents - reminders table - is named "reminders"', () => {
  assertEquals(getTableName(reminders), 'reminders');
})
    Deno.test('schema-agents - reminders table - has all required columns', () => {
  for (const col of ['id', 'accountId', 'content', 'triggerType', 'status', 'priority']) {
        assertEquals(hasColumn(reminders, col), true);
      }
})  
  
    Deno.test('schema-agents - threads table - defaults status to active', () => {
  const cols = getTableColumns(threads);
      assertEquals(cols.status.default, 'active');
})
    Deno.test('schema-agents - threads table - defaults contextWindow to 50', () => {
  const cols = getTableColumns(threads);
      assertEquals(cols.contextWindow.default, 50);
})  
  
    Deno.test('schema-agents - lgCheckpoints table - has composite primary key on threadId+checkpointNs+checkpointId', () => {
  const pks = primaryKeyNames(lgCheckpoints);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-agents - lgWrites table - has 5-column composite primary key', () => {
  const pks = primaryKeyNames(lgWrites);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-agents - memories table - has indexes for type+category and importance', () => {
  const idxs = indexNames(memories);
      assertStringIncludes(idxs, 'idx_memories_type_category');
      assertStringIncludes(idxs, 'idx_memories_importance');
})  
  
    Deno.test('schema-agents - skills table - has unique index on account+name', () => {
  const uniq = uniqueIndexNames(skills);
      assertStringIncludes(uniq, 'idx_skills_account_name');
})  
  
    Deno.test('schema-agents - threadShares table - has a unique token column', () => {
  assertEquals(hasColumn(threadShares, 'token'), true);
})  
  
    Deno.test('schema-agents - toolOperations table - has a unique index on run+operationKey', () => {
  const uniq = uniqueIndexNames(toolOperations);
      assertStringIncludes(uniq, 'idx_tool_operations_key');
})  
  
    Deno.test('schema-agents - artifacts table - defaults type to code and metadata to {}', () => {
  const cols = getTableColumns(artifacts);
      assertEquals(cols.type.default, 'code');
      assertEquals(cols.metadata.default, '{}');
})  
  
    Deno.test('schema-agents - infoUnits table - defaults kind to session', () => {
  const cols = getTableColumns(infoUnits);
      assertEquals(cols.kind.default, 'session');
})  
// ===================================================================
// schema-repos
// ===================================================================

  
    Deno.test('schema-repos - repositories table - is named "repositories"', () => {
  assertEquals(getTableName(repositories), 'repositories');
})
    Deno.test('schema-repos - repositories table - has unique index on account+name', () => {
  const uniq = uniqueIndexNames(repositories);
      assertStringIncludes(uniq, 'idx_repositories_account_name');
})
    Deno.test('schema-repos - repositories table - defaults visibility to private and defaultBranch to main', () => {
  const cols = getTableColumns(repositories);
      assertEquals(cols.visibility.default, 'private');
      assertEquals(cols.defaultBranch.default, 'main');
})
    Deno.test('schema-repos - repositories table - has gitEnabled, isOfficial, and featured boolean columns', () => {
  for (const col of ['gitEnabled', 'isOfficial', 'featured']) {
        assertEquals(hasColumn(repositories, col), true);
      }
})
    Deno.test('schema-repos - repositories table - has indexes for visibility, official, featured, and primary language', () => {
  const idxs = indexNames(repositories);
      assertStringIncludes(idxs, 'idx_repositories_visibility');
      assertStringIncludes(idxs, 'idx_repositories_is_official');
      assertStringIncludes(idxs, 'idx_repositories_featured');
      assertStringIncludes(idxs, 'idx_repositories_primary_language');
})  
  
    Deno.test('schema-repos - blobs table - has composite primary key on accountId+hash', () => {
  const pks = primaryKeyNames(blobs);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-repos - branches table - has unique index on repo+name', () => {
  const uniq = uniqueIndexNames(branches);
      assertStringIncludes(uniq, 'idx_branches_repo_name');
})  
  
    Deno.test('schema-repos - commits table - has unique index on repo+sha', () => {
  const uniq = uniqueIndexNames(commits);
      assertStringIncludes(uniq, 'idx_commits_repo_sha');
})
    Deno.test('schema-repos - commits table - has authorName, authorEmail, committerName, committerEmail columns', () => {
  for (const col of ['authorName', 'authorEmail', 'committerName', 'committerEmail']) {
        assertEquals(hasColumn(commits, col), true);
      }
})  
  
    Deno.test('schema-repos - files table - has unique index on account+path', () => {
  const uniq = uniqueIndexNames(files);
      assertStringIncludes(uniq, 'idx_files_account_path');
})
    Deno.test('schema-repos - files table - defaults origin to user and kind to source', () => {
  const cols = getTableColumns(files);
      assertEquals(cols.origin.default, 'user');
      assertEquals(cols.kind.default, 'source');
})  
  
    Deno.test('schema-repos - pullRequests table - has unique index on repo+number', () => {
  const uniq = uniqueIndexNames(pullRequests);
      assertStringIncludes(uniq, 'idx_pull_requests_repo_number');
})
    Deno.test('schema-repos - pullRequests table - defaults status to open', () => {
  const cols = getTableColumns(pullRequests);
      assertEquals(cols.status.default, 'open');
})  
  
    Deno.test('schema-repos - repoForks table - has indexes on fork and upstream', () => {
  const idxs = indexNames(repoForks);
      assertStringIncludes(idxs, 'idx_repo_forks_fork_repo_id');
      assertStringIncludes(idxs, 'idx_repo_forks_upstream_repo_id');
})  
  
    Deno.test('schema-repos - repoReleaseAssets table - has unique index on release+assetKey', () => {
  const uniq = uniqueIndexNames(repoReleaseAssets);
      assertStringIncludes(uniq, 'idx_repo_release_assets_release_asset_key');
})
    Deno.test('schema-repos - repoReleaseAssets table - has bundleFormat and bundleMetaJson columns', () => {
  assertEquals(hasColumn(repoReleaseAssets, 'bundleFormat'), true);
      assertEquals(hasColumn(repoReleaseAssets, 'bundleMetaJson'), true);
})  
  
    Deno.test('schema-repos - repoReleases table - has unique index on repo+tag', () => {
  const uniq = uniqueIndexNames(repoReleases);
      assertStringIncludes(uniq, 'idx_repo_releases_repo_tag');
})  
  
    Deno.test('schema-repos - repoStars table - has composite primary key on accountId+repoId', () => {
  const pks = primaryKeyNames(repoStars);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-repos - snapshots table - defaults status to pending', () => {
  const cols = getTableColumns(snapshots);
      assertEquals(cols.status.default, 'pending');
})  
  
    Deno.test('schema-repos - tags table - has unique index on repo+name', () => {
  const uniq = uniqueIndexNames(tags);
      assertStringIncludes(uniq, 'idx_tags_repo_name');
})  
  
    Deno.test('schema-repos - gitCommits table - has columns for filesChanged, insertions, deletions', () => {
  for (const col of ['filesChanged', 'insertions', 'deletions']) {
        assertEquals(hasColumn(gitCommits, col), true);
      }
})  
  
    Deno.test('schema-repos - gitFileChanges table - has changeType and oldPath columns', () => {
  assertEquals(hasColumn(gitFileChanges, 'changeType'), true);
      assertEquals(hasColumn(gitFileChanges, 'oldPath'), true);
})  
  
    Deno.test('schema-repos - chunks table - has indexes on file, account, and vector', () => {
  const idxs = indexNames(chunks);
      assertStringIncludes(idxs, 'idx_chunks_file_id');
      assertStringIncludes(idxs, 'idx_chunks_account_id');
      assertStringIncludes(idxs, 'idx_chunks_vector_id');
})  
  
    Deno.test('schema-repos - indexJobs table - defaults status to queued', () => {
  const cols = getTableColumns(indexJobs);
      assertEquals(cols.status.default, 'queued');
})  
  
    Deno.test('schema-repos - prComments table - defaults authorType to ai', () => {
  const cols = getTableColumns(prComments);
      assertEquals(cols.authorType.default, 'ai');
})  
  
    Deno.test('schema-repos - prReviews table - defaults reviewerType to ai', () => {
  const cols = getTableColumns(prReviews);
      assertEquals(cols.reviewerType.default, 'ai');
})  
  
    Deno.test('schema-repos - repoRemotes table - has unique index on repo+name', () => {
  const uniq = uniqueIndexNames(repoRemotes);
      assertStringIncludes(uniq, 'idx_repo_remotes_repo_name');
})
    Deno.test('schema-repos - repoRemotes table - defaults name to upstream', () => {
  const cols = getTableColumns(repoRemotes);
      assertEquals(cols.name.default, 'upstream');
})  
// ===================================================================
// schema-workers
// ===================================================================

  
    Deno.test('schema-workers - workers table - compatibility alias points at services', () => {
  assertEquals(getTableName(workers), 'services');
})
    Deno.test('schema-workers - workers table - defaults serviceType to app and status to pending while preserving workerType alias', () => {
  const cols = getTableColumns(workers);
      assertEquals(cols.serviceType.default, 'app');
      assertEquals(workers.workerType, workers.serviceType);
      assertEquals(cols.status.default, 'pending');
})
    Deno.test('schema-workers - workers table - has unique columns hostname, routeRef, and slug', () => {
  assertEquals(hasColumn(workers, 'hostname'), true);
      assertEquals(hasColumn(workers, 'routeRef'), true);
      assertEquals(hasColumn(workers, 'slug'), true);
})
    Deno.test('schema-workers - workers table - has unique index on id+accountId', () => {
  const uniq = uniqueIndexNames(workers);
      assertStringIncludes(uniq, 'idx_services_id_account');
})  
  
    Deno.test('schema-workers - apps table - is named "apps"', () => {
  assertEquals(getTableName(apps), 'apps');
})
    Deno.test('schema-workers - apps table - has service-centric indexes on service, appType, and account', () => {
  const idxs = indexNames(apps);
      assertStringIncludes(idxs, 'idx_apps_service_id');
      assertStringIncludes(idxs, 'idx_apps_app_type');
      assertStringIncludes(idxs, 'idx_apps_account_id');
})
    Deno.test('schema-workers - apps table - has physical serviceId column with workerId compatibility alias', () => {
  assertEquals(hasColumn(apps, 'serviceId'), true);
      assertEquals(apps.workerId, apps.serviceId);
})  
  
    Deno.test('schema-workers - shortcutGroupItems table - has physical serviceId column with workerId compatibility alias', () => {
  assertEquals(hasColumn(shortcutGroupItems, 'serviceId'), true);
      assertEquals(shortcutGroupItems.workerId, shortcutGroupItems.serviceId);
})  
  
    Deno.test('schema-workers - deployments table - has unique index on service+version', () => {
  const uniq = uniqueIndexNames(deployments);
      assertStringIncludes(uniq, 'idx_deployments_service_version');
})
    Deno.test('schema-workers - deployments table - has rollback columns', () => {
  for (const col of ['isRollback', 'rollbackFromVersion', 'rolledBackAt', 'rolledBackBy']) {
        assertEquals(hasColumn(deployments, col), true);
      }
})  
  
    Deno.test('schema-workers - bundleDeployments table - has unique index on account+name and account+app', () => {
  const uniq = uniqueIndexNames(bundleDeployments);
      assertStringIncludes(uniq, 'idx_bundle_deployments_account_name');
      assertStringIncludes(uniq, 'idx_bundle_deployments_account_app');
})  
  
    Deno.test('schema-workers - customDomains table - defaults status to pending', () => {
  const cols = getTableColumns(customDomains);
      assertEquals(cols.status.default, 'pending');
})
    Deno.test('schema-workers - customDomains table - uses service_id as the physical foreign key column', () => {
  assertEquals(hasColumn(customDomains, 'serviceId'), true);
})
    Deno.test('schema-workers - customDomains table - exposes a serviceId alias for canonical core reads', () => {
  assertEquals(serviceCustomDomains.serviceId, customDomains.workerId);
})  
  
    Deno.test('schema-workers - workerBindings table - has unique index on worker+bindingName', () => {
  const uniq = uniqueIndexNames(workerBindings);
      assertStringIncludes(uniq, 'idx_service_bindings_service_binding');
})  
  
    Deno.test('schema-workers - workerCommonEnvLinks table - has unique index on worker+envName+source', () => {
  const uniq = uniqueIndexNames(workerCommonEnvLinks);
      assertStringIncludes(uniq, 'idx_service_common_env_links_service_env_source');
})  
  
    Deno.test('schema-workers - workerEnvVars table - has unique index on service+name', () => {
  const uniq = uniqueIndexNames(workerEnvVars);
      assertStringIncludes(uniq, 'idx_service_env_vars_service_name');
})
    Deno.test('schema-workers - workerEnvVars table - uses service_id as the physical foreign key column', () => {
  assertEquals(hasColumn(workerEnvVars, 'serviceId'), true);
})
    Deno.test('schema-workers - workerEnvVars table - exposes a serviceId alias', () => {
  assertEquals(serviceEnvVars.serviceId, workerEnvVars.workerId);
})  
  
    Deno.test('schema-workers - workerMcpEndpoints table - has composite primary key on serviceId+name', () => {
  const pks = primaryKeyNames(workerMcpEndpoints);
      assert(pks.length >= 1);
})
    Deno.test('schema-workers - workerMcpEndpoints table - uses service_id as the physical foreign key column', () => {
  assertEquals(hasColumn(workerMcpEndpoints, 'serviceId'), true);
})
    Deno.test('schema-workers - workerMcpEndpoints table - exposes a serviceId alias', () => {
  assertEquals(serviceMcpEndpoints.serviceId, workerMcpEndpoints.workerId);
})  
  
    Deno.test('schema-workers - workerRuntimeFlags table - has composite primary key on serviceId+flag', () => {
  const pks = primaryKeyNames(workerRuntimeFlags);
      assert(pks.length >= 1);
})
    Deno.test('schema-workers - workerRuntimeFlags table - uses service_id as the physical foreign key column', () => {
  assertEquals(hasColumn(workerRuntimeFlags, 'serviceId'), true);
})
    Deno.test('schema-workers - workerRuntimeFlags table - exposes a serviceId alias', () => {
  assertEquals(serviceRuntimeFlags.serviceId, workerRuntimeFlags.workerId);
})  
  
    Deno.test('schema-workers - workerRuntimeLimits table - uses serviceId as primary key', () => {
  const cols = getTableColumns(workerRuntimeLimits);
      assertEquals(cols.serviceId.primary, true);
})
    Deno.test('schema-workers - workerRuntimeLimits table - has cpuMs, memoryMb, and subrequestLimit columns', () => {
  for (const col of ['cpuMs', 'memoryMb', 'subrequestLimit']) {
        assertEquals(hasColumn(workerRuntimeLimits, col), true);
      }
})
    Deno.test('schema-workers - workerRuntimeLimits table - exposes a serviceId alias', () => {
  assertEquals(serviceRuntimeLimits.serviceId, workerRuntimeLimits.workerId);
})  
  
    Deno.test('schema-workers - workerRuntimeSettings table - uses serviceId as primary key', () => {
  const cols = getTableColumns(workerRuntimeSettings);
      assertEquals(cols.serviceId.primary, true);
})
    Deno.test('schema-workers - workerRuntimeSettings table - uses service-centric account index naming', () => {
  const idxs = indexNames(workerRuntimeSettings);
      assertStringIncludes(idxs, 'idx_service_runtime_settings_account_id');
})
    Deno.test('schema-workers - workerRuntimeSettings table - exposes a serviceId alias', () => {
  assertEquals(serviceRuntimeSettings.serviceId, workerRuntimeSettings.workerId);
})  
  
    Deno.test('schema-workers - managedTakosTokens table - has unique index on service+envName', () => {
  const uniq = uniqueIndexNames(managedTakosTokens);
      assertStringIncludes(uniq, 'idx_managed_takos_tokens_service_env');
})
    Deno.test('schema-workers - managedTakosTokens table - uses service_id as the physical foreign key column', () => {
  assertEquals(hasColumn(managedTakosTokens, 'serviceId'), true);
})
    Deno.test('schema-workers - managedTakosTokens table - exposes a workerId compat alias', () => {
  assertEquals(serviceManagedTakosTokens.serviceId, managedTakosTokens.workerId);
})  
  
    Deno.test('schema-workers - commonEnvAuditLogs table - has composite indexes for account+env+createdAt and service+createdAt', () => {
  const idxs = indexNames(commonEnvAuditLogs);
      assertStringIncludes(idxs, 'idx_common_env_audit_logs_account_env_created_at');
      assertStringIncludes(idxs, 'idx_common_env_audit_logs_service_created_at');
})
    Deno.test('schema-workers - commonEnvAuditLogs table - exposes a workerId compat alias', () => {
  assertEquals(serviceCommonEnvAuditLogs.serviceId, commonEnvAuditLogs.workerId);
})  
  
    Deno.test('schema-workers - commonEnvReconcileJobs table - has indexes on status+nextAttemptAt and account+service+status', () => {
  const idxs = indexNames(commonEnvReconcileJobs);
      assertStringIncludes(idxs, 'idx_common_env_reconcile_jobs_status_next_attempt');
      assertStringIncludes(idxs, 'idx_common_env_reconcile_jobs_account_service_status');
})
    Deno.test('schema-workers - commonEnvReconcileJobs table - uses service_id as the physical foreign key column', () => {
  assertEquals(hasColumn(commonEnvReconcileJobs, 'serviceId'), true);
})
    Deno.test('schema-workers - commonEnvReconcileJobs table - exposes a workerId compat alias', () => {
  assertEquals(serviceCommonEnvReconcileJobs.serviceId, commonEnvReconcileJobs.workerId);
})  
  
    Deno.test('schema-workers - deploymentEvents table - uses auto-increment integer primary key', () => {
  const cols = getTableColumns(deploymentEvents);
      assertEquals(cols.id.primary, true);
})  
  
    Deno.test('schema-workers - bundleDeploymentEvents table - has index on bundleKey and account', () => {
  const idxs = indexNames(bundleDeploymentEvents);
      assertStringIncludes(idxs, 'idx_bundle_deployment_events_bundle_key');
      assertStringIncludes(idxs, 'idx_bundle_deployment_events_account_id');
})  
// ===================================================================
// schema-oauth
// ===================================================================

  
    Deno.test('schema-oauth - oauthClients table - is named "oauth_clients"', () => {
  assertEquals(getTableName(oauthClients), 'oauth_clients');
})
    Deno.test('schema-oauth - oauthClients table - defaults clientType to confidential and status to active', () => {
  const cols = getTableColumns(oauthClients);
      assertEquals(cols.clientType.default, 'confidential');
      assertEquals(cols.status.default, 'active');
})  
  
    Deno.test('schema-oauth - oauthTokens table - has indexes for tokenType, tokenHash, tokenFamily, revoked, and expiresAt', () => {
  const idxs = indexNames(oauthTokens);
      assertStringIncludes(idxs, 'idx_oauth_tokens_token_type');
      assertStringIncludes(idxs, 'idx_oauth_tokens_token_hash');
      assertStringIncludes(idxs, 'idx_oauth_tokens_token_family');
      assertStringIncludes(idxs, 'idx_oauth_tokens_revoked');
      assertStringIncludes(idxs, 'idx_oauth_tokens_expires_at');
})  
  
    Deno.test('schema-oauth - oauthAuthorizationCodes table - has codeChallenge and codeChallengeMethod for PKCE', () => {
  assertEquals(hasColumn(oauthAuthorizationCodes, 'codeChallenge'), true);
      assertEquals(hasColumn(oauthAuthorizationCodes, 'codeChallengeMethod'), true);
})
    Deno.test('schema-oauth - oauthAuthorizationCodes table - defaults codeChallengeMethod to S256', () => {
  const cols = getTableColumns(oauthAuthorizationCodes);
      assertEquals(cols.codeChallengeMethod.default, 'S256');
})  
  
    Deno.test('schema-oauth - oauthConsents table - has unique index on account+client', () => {
  const uniq = uniqueIndexNames(oauthConsents);
      assertStringIncludes(uniq, 'idx_oauth_consents_account_client');
})  
  
    Deno.test('schema-oauth - oauthDeviceCodes table - defaults status to pending', () => {
  const cols = getTableColumns(oauthDeviceCodes);
      assertEquals(cols.status.default, 'pending');
})
    Deno.test('schema-oauth - oauthDeviceCodes table - defaults intervalSeconds to 5', () => {
  const cols = getTableColumns(oauthDeviceCodes);
      assertEquals(cols.intervalSeconds.default, 5);
})  
  
    Deno.test('schema-oauth - oauthStates table - has indexes on state and expiresAt', () => {
  const idxs = indexNames(oauthStates);
      assertStringIncludes(idxs, 'idx_oauth_states_state');
      assertStringIncludes(idxs, 'idx_oauth_states_expires_at');
})  
  
    Deno.test('schema-oauth - oauthAuditLogs table - has indexes on eventType, createdAt, clientId, and accountId', () => {
  const idxs = indexNames(oauthAuditLogs);
      assertStringIncludes(idxs, 'idx_oauth_audit_logs_event_type');
      assertStringIncludes(idxs, 'idx_oauth_audit_logs_created_at');
      assertStringIncludes(idxs, 'idx_oauth_audit_logs_client_id');
      assertStringIncludes(idxs, 'idx_oauth_audit_logs_account_id');
})  
  
    Deno.test('schema-oauth - mcpServers table - has unique index on account+name', () => {
  const uniq = uniqueIndexNames(mcpServers);
      assertStringIncludes(uniq, 'idx_mcp_servers_account_name');
})
    Deno.test('schema-oauth - mcpServers table - defaults transport to streamable-http', () => {
  const cols = getTableColumns(mcpServers);
      assertEquals(cols.transport.default, 'streamable-http');
      assertEquals(mcpServers.serviceId, mcpServers.workerId);
      assertStringIncludes(indexNames(mcpServers), 'idx_mcp_servers_service_id');
})  
  
    Deno.test('schema-oauth - mcpOauthPending table - has indexes on state and accountId', () => {
  const idxs = indexNames(mcpOauthPending);
      assertStringIncludes(idxs, 'idx_mcp_oauth_pending_state');
      assertStringIncludes(idxs, 'idx_mcp_oauth_pending_account_id');
})  
// ===================================================================
// schema-platform
// ===================================================================

  
    Deno.test('schema-platform - resources table - is named "resources"', () => {
  assertEquals(getTableName(resources), 'resources');
})
    Deno.test('schema-platform - resources table - defaults status to provisioning', () => {
  const cols = getTableColumns(resources);
      assertEquals(cols.status.default, 'provisioning');
})
    Deno.test('schema-platform - resources table - has indexes on type, semanticType, providerName, status, owner, providerResourceId, and account', () => {
  const idxs = indexNames(resources);
      assertStringIncludes(idxs, 'idx_resources_type');
      assertStringIncludes(idxs, 'idx_resources_semantic_type');
      assertStringIncludes(idxs, 'idx_resources_provider_name');
      assertStringIncludes(idxs, 'idx_resources_status');
      assertStringIncludes(idxs, 'idx_resources_owner_account_id');
      assertStringIncludes(idxs, 'idx_resources_provider_resource_id');
      assertStringIncludes(idxs, 'idx_resources_account_id');
})  
  
    Deno.test('schema-platform - resourceAccess table - has unique index on resource+account', () => {
  const uniq = uniqueIndexNames(resourceAccess);
      assertStringIncludes(uniq, 'idx_resource_access_resource_account');
})
    Deno.test('schema-platform - resourceAccess table - defaults permission to read', () => {
  const cols = getTableColumns(resourceAccess);
      assertEquals(cols.permission.default, 'read');
})  
  
    Deno.test('schema-platform - resourceAccessTokens table - has indexes on tokenHash and resource', () => {
  const idxs = indexNames(resourceAccessTokens);
      assertStringIncludes(idxs, 'idx_resource_access_tokens_token_hash');
      assertStringIncludes(idxs, 'idx_resource_access_tokens_resource_id');
})  
  
    Deno.test('schema-platform - edges table - has indexes on source, target, type, and account', () => {
  const idxs = indexNames(edges);
      assertStringIncludes(idxs, 'idx_edges_source_id');
      assertStringIncludes(idxs, 'idx_edges_target_id');
      assertStringIncludes(idxs, 'idx_edges_type');
      assertStringIncludes(idxs, 'idx_edges_account_id');
})  
  
    Deno.test('schema-platform - nodes table - has indexes on type, refId, and account', () => {
  const idxs = indexNames(nodes);
      assertStringIncludes(idxs, 'idx_nodes_type');
      assertStringIncludes(idxs, 'idx_nodes_ref_id');
      assertStringIncludes(idxs, 'idx_nodes_account_id');
})  
  
    Deno.test('schema-platform - notifications table - is named "notifications"', () => {
  assertEquals(getTableName(notifications), 'notifications');
})
    Deno.test('schema-platform - notifications table - has email tracking columns', () => {
  for (const col of ['emailStatus', 'emailAttempts', 'emailSentAt', 'emailError']) {
        assertEquals(hasColumn(notifications, col), true);
      }
})  
  
    Deno.test('schema-platform - notificationPreferences table - has composite primary key on accountId+type+channel', () => {
  const pks = primaryKeyNames(notificationPreferences);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-platform - notificationSettings table - uses accountId as primary key', () => {
  const cols = getTableColumns(notificationSettings);
      assertEquals(cols.accountId.primary, true);
})  
  
    Deno.test('schema-platform - sessions table - is named "sessions"', () => {
  assertEquals(getTableName(sessions), 'sessions');
})
    Deno.test('schema-platform - sessions table - has columns for repoId and branch', () => {
  assertEquals(hasColumn(sessions, 'repoId'), true);
      assertEquals(hasColumn(sessions, 'branch'), true);
})  
  
    Deno.test('schema-platform - sessionFiles table - has unique index on session+path', () => {
  const uniq = uniqueIndexNames(sessionFiles);
      assertStringIncludes(uniq, 'idx_session_files_session_path');
})  
  
    Deno.test('schema-platform - sessionRepos table - has unique indexes on session+repo and session+mount', () => {
  const uniq = uniqueIndexNames(sessionRepos);
      assertStringIncludes(uniq, 'idx_session_repos_session_repo');
      assertStringIncludes(uniq, 'idx_session_repos_session_mount');
})  
  
    Deno.test('schema-platform - shortcuts table - has unique index on user+resourceType+resourceId', () => {
  const uniq = uniqueIndexNames(shortcuts);
      assertStringIncludes(uniq, 'idx_shortcuts_user_resource_type_id');
})  
  
    Deno.test('schema-platform - uiExtensions table - has unique index on account+path', () => {
  const uniq = uniqueIndexNames(uiExtensions);
      assertStringIncludes(uniq, 'idx_ui_extensions_account_path');
})  
  
    Deno.test('schema-platform - reports table - defaults status to open', () => {
  const cols = getTableColumns(reports);
      assertEquals(cols.status.default, 'open');
})  
  
    Deno.test('schema-platform - moderationAuditLogs table - has indexes on targetType+id, report, createdAt, actor, and actionType', () => {
  const idxs = indexNames(moderationAuditLogs);
      assertStringIncludes(idxs, 'idx_moderation_audit_logs_target_type_id');
      assertStringIncludes(idxs, 'idx_moderation_audit_logs_report_id');
      assertStringIncludes(idxs, 'idx_moderation_audit_logs_created_at');
      assertStringIncludes(idxs, 'idx_moderation_audit_logs_actor_account_id');
      assertStringIncludes(idxs, 'idx_moderation_audit_logs_action_type');
})  
  
    Deno.test('schema-platform - infraEndpoints table - has unique index on account+name', () => {
  const uniq = uniqueIndexNames(infraEndpoints);
      assertStringIncludes(uniq, 'idx_infra_endpoints_account_name');
})  
  
    Deno.test('schema-platform - serviceRuntimes table - has unique index on account+name', () => {
  const uniq = uniqueIndexNames(serviceRuntimes);
      assertStringIncludes(uniq, 'idx_service_runtimes_account_name');
})  
  
    Deno.test('schema-platform - infraEndpointRoutes table - has composite primary key on endpointId+position', () => {
  const pks = primaryKeyNames(infraEndpointRoutes);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-platform - fileHandlers table - uses service_hostname as the physical hostname column', () => {
  assertEquals(hasColumn(fileHandlers, 'serviceHostname'), true);
})
    Deno.test('schema-platform - fileHandlers table - retains workerHostname as a compatibility alias', () => {
  assertEquals(fileHandlers.workerHostname, fileHandlers.serviceHostname);
})  
  
    Deno.test('schema-platform - fileHandlerMatchers table - has composite primary key on fileHandlerId+kind+value', () => {
  const pks = primaryKeyNames(fileHandlerMatchers);
      assert(pks.length >= 1);
})  
  
    Deno.test('schema-platform - dlqEntries table - is named "dlq_entries"', () => {
  assertEquals(getTableName(dlqEntries), 'dlq_entries');
})  
  
    Deno.test('schema-platform - storeRegistry table - has unique index on account+actorUrl', () => {
  const uniq = uniqueIndexNames(storeRegistry);
      assertStringIncludes(uniq, 'idx_store_registry_account_actor');
})  
  
    Deno.test('schema-platform - storeRegistryUpdates table - has unique index on registryEntryId+activityId', () => {
  const uniq = uniqueIndexNames(storeRegistryUpdates);
      assertStringIncludes(uniq, 'idx_store_registry_updates_activity');
})  
// ===================================================================
// schema-workflows
// ===================================================================

  
    Deno.test('schema-workflows - workflows table - is named "workflows"', () => {
  assertEquals(getTableName(workflows), 'workflows');
})
    Deno.test('schema-workflows - workflows table - has unique index on repo+path', () => {
  const uniq = uniqueIndexNames(workflows);
      assertStringIncludes(uniq, 'idx_workflows_repo_path');
})  
  
    Deno.test('schema-workflows - workflowRuns table - defaults status to queued and runAttempt to 1', () => {
  const cols = getTableColumns(workflowRuns);
      assertEquals(cols.status.default, 'queued');
      assertEquals(cols.runAttempt.default, 1);
})
    Deno.test('schema-workflows - workflowRuns table - has indexes for workflow, status, repo, event, createdAt, and actor', () => {
  const idxs = indexNames(workflowRuns);
      assertStringIncludes(idxs, 'idx_workflow_runs_workflow_id');
      assertStringIncludes(idxs, 'idx_workflow_runs_status');
      assertStringIncludes(idxs, 'idx_workflow_runs_repo_id');
      assertStringIncludes(idxs, 'idx_workflow_runs_event');
      assertStringIncludes(idxs, 'idx_workflow_runs_created_at');
      assertStringIncludes(idxs, 'idx_workflow_runs_actor_account_id');
})  
  
    Deno.test('schema-workflows - workflowJobs table - defaults status to queued', () => {
  const cols = getTableColumns(workflowJobs);
      assertEquals(cols.status.default, 'queued');
})  
  
    Deno.test('schema-workflows - workflowSteps table - defaults status to pending', () => {
  const cols = getTableColumns(workflowSteps);
      assertEquals(cols.status.default, 'pending');
})
    Deno.test('schema-workflows - workflowSteps table - has indexes on job+number and jobId', () => {
  const idxs = indexNames(workflowSteps);
      assertStringIncludes(idxs, 'idx_workflow_steps_job_number');
      assertStringIncludes(idxs, 'idx_workflow_steps_job_id');
})  
  
    Deno.test('schema-workflows - workflowSecrets table - has unique index on repo+name', () => {
  const uniq = uniqueIndexNames(workflowSecrets);
      assertStringIncludes(uniq, 'idx_workflow_secrets_repo_name');
})  
  
    Deno.test('schema-workflows - workflowArtifacts table - has indexes on run and expiresAt', () => {
  const idxs = indexNames(workflowArtifacts);
      assertStringIncludes(idxs, 'idx_workflow_artifacts_run_id');
      assertStringIncludes(idxs, 'idx_workflow_artifacts_expires_at');
})  
// ===================================================================
// Cross-schema: all tables have expected names (no accidental rename)
// ===================================================================

  const expectedNames: [Parameters<typeof getTableName>[0], string][] = [
    [accounts, 'accounts'],
    [accountBlocks, 'account_blocks'],
    [accountEnvVars, 'account_env_vars'],
    [accountFollowRequests, 'account_follow_requests'],
    [accountFollows, 'account_follows'],
    [accountMemberships, 'account_memberships'],
    [accountMetadata, 'account_metadata'],
    [accountModeration, 'account_moderation'],
    [accountMutes, 'account_mutes'],
    [accountSettings, 'account_settings'],
    [accountStats, 'account_stats'],
    [accountStorageFiles, 'account_storage_files'],
    [authIdentities, 'auth_identities'],
    [authServices, 'auth_services'],
    [authSessions, 'auth_sessions'],
    [personalAccessTokens, 'personal_access_tokens'],
    [serviceTokens, 'service_tokens'],
    [billingAccounts, 'billing_accounts'],
    [billingPlanFeatures, 'billing_plan_features'],
    [billingPlanQuotas, 'billing_plan_quotas'],
    [billingPlanRates, 'billing_plan_rates'],
    [billingPlans, 'billing_plans'],
    [billingTransactions, 'billing_transactions'],
    [usageEvents, 'usage_events'],
    [usageRollups, 'usage_rollups'],
    [agentTasks, 'agent_tasks'],
    [artifacts, 'artifacts'],
    [infoUnits, 'info_units'],
    [lgCheckpoints, 'lg_checkpoints'],
    [lgWrites, 'lg_writes'],
    [memories, 'memories'],
    [messages, 'messages'],
    [reminders, 'reminders'],
    [runEvents, 'run_events'],
    [runs, 'runs'],
    [skills, 'skills'],
    [threadShares, 'thread_shares'],
    [threads, 'threads'],
    [toolOperations, 'tool_operations'],
    [blobs, 'blobs'],
    [branches, 'branches'],
    [chunks, 'chunks'],
    [commits, 'commits'],
    [files, 'files'],
    [gitCommits, 'git_commits'],
    [gitFileChanges, 'git_file_changes'],
    [indexJobs, 'index_jobs'],
    [prComments, 'pr_comments'],
    [prReviews, 'pr_reviews'],
    [pullRequests, 'pull_requests'],
    [repoForks, 'repo_forks'],
    [repoReleaseAssets, 'repo_release_assets'],
    [repoReleases, 'repo_releases'],
    [repoRemotes, 'repo_remotes'],
    [repoStars, 'repo_stars'],
    [repositories, 'repositories'],
    [snapshots, 'snapshots'],
    [tags, 'tags'],
    [apps, 'apps'],
    [bundleDeploymentEvents, 'bundle_deployment_events'],
    [bundleDeployments, 'bundle_deployments'],
    [commonEnvAuditLogs, 'common_env_audit_logs'],
    [commonEnvReconcileJobs, 'common_env_reconcile_jobs'],
    [customDomains, 'custom_domains'],
    [deploymentEvents, 'deployment_events'],
    [deployments, 'deployments'],
    [managedTakosTokens, 'managed_takos_tokens'],
    [workerBindings, 'service_bindings'],
    [workerCommonEnvLinks, 'service_common_env_links'],
    [workerEnvVars, 'service_env_vars'],
    [workerMcpEndpoints, 'service_mcp_endpoints'],
    [workerRuntimeFlags, 'service_runtime_flags'],
    [workerRuntimeLimits, 'service_runtime_limits'],
    [workerRuntimeSettings, 'service_runtime_settings'],
    [workers, 'services'],
    [mcpOauthPending, 'mcp_oauth_pending'],
    [mcpServers, 'mcp_servers'],
    [oauthAuditLogs, 'oauth_audit_logs'],
    [oauthAuthorizationCodes, 'oauth_authorization_codes'],
    [oauthClients, 'oauth_clients'],
    [oauthConsents, 'oauth_consents'],
    [oauthDeviceCodes, 'oauth_device_codes'],
    [oauthStates, 'oauth_states'],
    [oauthTokens, 'oauth_tokens'],
    [edges, 'edges'],
    [fileHandlerMatchers, 'file_handler_matchers'],
    [fileHandlers, 'file_handlers'],
    [infraEndpointRoutes, 'infra_endpoint_routes'],
    [infraEndpoints, 'infra_endpoints'],
    [serviceRuntimes, 'service_runtimes'],
    [moderationAuditLogs, 'moderation_audit_logs'],
    [nodes, 'nodes'],
    [notificationPreferences, 'notification_preferences'],
    [notificationSettings, 'notification_settings'],
    [notifications, 'notifications'],
    [reports, 'reports'],
    [resourceAccess, 'resource_access'],
    [resourceAccessTokens, 'resource_access_tokens'],
    [resources, 'resources'],
    [sessionFiles, 'session_files'],
    [sessionRepos, 'session_repos'],
    [sessions, 'sessions'],
    [shortcutGroupItems, 'shortcut_group_items'],
    [shortcutGroups, 'shortcut_groups'],
    [shortcuts, 'shortcuts'],
    [uiExtensions, 'ui_extensions'],
    [dlqEntries, 'dlq_entries'],
    [storeRegistry, 'store_registry'],
    [storeRegistryUpdates, 'store_registry_updates'],
    [workflowArtifacts, 'workflow_artifacts'],
    [workflowJobs, 'workflow_jobs'],
    [workflowRuns, 'workflow_runs'],
    [workflowSecrets, 'workflow_secrets'],
    [workflowSteps, 'workflow_steps'],
    [workflows, 'workflows'],
  ];

  it.each(expectedNames)('table %# has expected SQL name "%s"', (table, expectedSqlName) => {
    assertEquals(getTableName(table), expectedSqlName);
  });
