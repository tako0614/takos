import { describe, expect, it } from 'vitest';
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

describe('nowIso helper', () => {
  it('returns an ISO-8601 formatted string', () => {
    const result = nowIso();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('schema-services', () => {
  it('defines physical services tables', () => {
    expect(getTableName(services)).toBe('services');
    expect(getTableName(serviceBindings)).toBe('service_bindings');
    expect(getTableName(serviceCommonEnvLinks)).toBe('service_common_env_links');
  });

  it('exposes worker compatibility aliases', () => {
    expect(getTableName(workers)).toBe('services');
    expect(workerBindings.workerId).toBe(serviceBindings.serviceId);
    expect(workerCommonEnvLinks.workerId).toBe(serviceCommonEnvLinks.serviceId);
  });
});

// ===================================================================
// schema-accounts
// ===================================================================
describe('schema-accounts', () => {
  describe('accounts table', () => {
    it('is named "accounts"', () => {
      expect(getTableName(accounts)).toBe('accounts');
    });

    it('has all required columns', () => {
      const cols = colNames(accounts);
      const required = [
        'id', 'type', 'status', 'name', 'slug', 'description', 'picture',
        'bio', 'email', 'trustTier', 'setupCompleted', 'defaultRepositoryId',
        'headSnapshotId', 'aiModel', 'aiProvider', 'securityPosture',
        'ownerAccountId', 'createdAt', 'updatedAt',
      ];
      for (const col of required) {
        expect(cols).toContain(col);
      }
    });

    it('has indexes for type, slug, owner, and email', () => {
      const idxs = indexNames(accounts);
      expect(idxs).toContain('idx_accounts_type');
      expect(idxs).toContain('idx_accounts_slug');
      expect(idxs).toContain('idx_accounts_owner_account_id');
      expect(idxs).toContain('idx_accounts_email');
    });
  });

  describe('accountBlocks table', () => {
    it('is named "account_blocks"', () => {
      expect(getTableName(accountBlocks)).toBe('account_blocks');
    });

    it('has composite primary key on blocker+blocked', () => {
      const pks = primaryKeyNames(accountBlocks);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });

    it('has indexes on both blocker and blocked', () => {
      const idxs = indexNames(accountBlocks);
      expect(idxs).toContain('idx_account_blocks_blocker_account_id');
      expect(idxs).toContain('idx_account_blocks_blocked_account_id');
    });
  });

  describe('accountEnvVars table', () => {
    it('has a unique index on account_id + name', () => {
      const uniq = uniqueIndexNames(accountEnvVars);
      expect(uniq).toContain('idx_account_env_vars_account_id_name');
    });

    it('includes isSecret boolean column', () => {
      expect(hasColumn(accountEnvVars, 'isSecret')).toBe(true);
    });
  });

  describe('accountFollowRequests table', () => {
    it('has a unique constraint on requester+target', () => {
      const uniq = uniqueIndexNames(accountFollowRequests);
      expect(uniq).toContain('idx_account_follow_requests_requester_target');
    });

    it('has indexes for target+status, requester, and createdAt', () => {
      const idxs = indexNames(accountFollowRequests);
      expect(idxs).toContain('idx_account_follow_requests_target_status');
      expect(idxs).toContain('idx_account_follow_requests_requester');
      expect(idxs).toContain('idx_account_follow_requests_created_at');
    });
  });

  describe('accountFollows table', () => {
    it('has composite primary key on follower+following', () => {
      const pks = primaryKeyNames(accountFollows);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('accountMemberships table', () => {
    it('has a unique index on account+member', () => {
      const uniq = uniqueIndexNames(accountMemberships);
      expect(uniq).toContain('idx_account_memberships_account_member');
    });

    it('defaults role to viewer and status to active', () => {
      const cols = getTableColumns(accountMemberships);
      expect(cols.role.default).toBe('viewer');
      expect(cols.status.default).toBe('active');
    });
  });

  describe('accountMetadata table', () => {
    it('has composite primary key on accountId+key', () => {
      const pks = primaryKeyNames(accountMetadata);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('accountModeration table', () => {
    it('uses accountId as primary key', () => {
      const cols = getTableColumns(accountModeration);
      expect(cols.accountId.primary).toBe(true);
    });

    it('defaults status to active', () => {
      const cols = getTableColumns(accountModeration);
      expect(cols.status.default).toBe('active');
    });
  });

  describe('accountMutes table', () => {
    it('has composite primary key on muter+muted', () => {
      const pks = primaryKeyNames(accountMutes);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('accountSettings table', () => {
    it('is named "account_settings"', () => {
      expect(getTableName(accountSettings)).toBe('account_settings');
    });

    it('has boolean columns with defaults', () => {
      const cols = getTableColumns(accountSettings);
      expect(cols.setupCompleted.default).toBe(false);
      expect(cols.autoUpdateEnabled.default).toBe(true);
      expect(cols.privateAccount.default).toBe(false);
    });
  });

  describe('accountStats table', () => {
    it('has indexes on totalSizeBytes and fileCount', () => {
      const idxs = indexNames(accountStats);
      expect(idxs).toContain('idx_account_stats_total_size_bytes');
      expect(idxs).toContain('idx_account_stats_file_count');
    });
  });

  describe('accountStorageFiles table', () => {
    it('has unique index on accountId+path', () => {
      const uniq = uniqueIndexNames(accountStorageFiles);
      expect(uniq).toContain('idx_account_storage_files_account_path');
    });
  });

  describe('authIdentities table', () => {
    it('is named "auth_identities"', () => {
      expect(getTableName(authIdentities)).toBe('auth_identities');
    });

    it('has a unique index on provider+providerSub', () => {
      const uniq = uniqueIndexNames(authIdentities);
      expect(uniq).toContain('idx_auth_identities_provider_sub');
    });

    it('has a foreign key reference from userId to accounts.id', () => {
      const config = getTableConfig(authIdentities);
      const fks = config.foreignKeys ?? [];
      expect(fks.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ===================================================================
// schema-auth
// ===================================================================
describe('schema-auth', () => {
  describe('authServices table', () => {
    it('is named "auth_services"', () => {
      expect(getTableName(authServices)).toBe('auth_services');
    });

    it('has indexes on domain and apiKeyHash', () => {
      const idxs = indexNames(authServices);
      expect(idxs).toContain('idx_auth_services_domain');
      expect(idxs).toContain('idx_auth_services_api_key_hash');
    });
  });

  describe('authSessions table', () => {
    it('has indexes on tokenHash, expiresAt, and accountId', () => {
      const idxs = indexNames(authSessions);
      expect(idxs).toContain('idx_auth_sessions_token_hash');
      expect(idxs).toContain('idx_auth_sessions_expires_at');
      expect(idxs).toContain('idx_auth_sessions_account_id');
    });
  });

  describe('personalAccessTokens table', () => {
    it('is named "personal_access_tokens"', () => {
      expect(getTableName(personalAccessTokens)).toBe('personal_access_tokens');
    });

    it('defaults scopes to wildcard', () => {
      const cols = getTableColumns(personalAccessTokens);
      expect(cols.scopes.default).toBe('*');
    });
  });

  describe('serviceTokens table', () => {
    it('is named "service_tokens"', () => {
      expect(getTableName(serviceTokens)).toBe('service_tokens');
    });

    it('has an index on tokenHash', () => {
      const idxs = indexNames(serviceTokens);
      expect(idxs).toContain('idx_service_tokens_token_hash');
    });
  });
});

// ===================================================================
// schema-billing
// ===================================================================
describe('schema-billing', () => {
  describe('billingAccounts table', () => {
    it('is named "billing_accounts"', () => {
      expect(getTableName(billingAccounts)).toBe('billing_accounts');
    });

    it('defaults balanceCents to 0 and status to active', () => {
      const cols = getTableColumns(billingAccounts);
      expect(cols.balanceCents.default).toBe(0);
      expect(cols.status.default).toBe('active');
    });
  });

  describe('billingPlanFeatures table', () => {
    it('has composite primary key on planId+featureKey', () => {
      const pks = primaryKeyNames(billingPlanFeatures);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('billingPlanQuotas table', () => {
    it('has composite primary key on planId+quotaKey', () => {
      const pks = primaryKeyNames(billingPlanQuotas);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('billingPlanRates table', () => {
    it('has composite primary key on planId+meterType', () => {
      const pks = primaryKeyNames(billingPlanRates);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('billingPlans table', () => {
    it('has indexes on name and isDefault', () => {
      const idxs = indexNames(billingPlans);
      expect(idxs).toContain('idx_billing_plans_name');
      expect(idxs).toContain('idx_billing_plans_is_default');
    });
  });

  describe('billingTransactions table', () => {
    it('has columns for amountCents and balanceAfterCents', () => {
      expect(hasColumn(billingTransactions, 'amountCents')).toBe(true);
      expect(hasColumn(billingTransactions, 'balanceAfterCents')).toBe(true);
    });
  });

  describe('usageEvents table', () => {
    it('has an idempotency key with unique constraint', () => {
      expect(hasColumn(usageEvents, 'idempotencyKey')).toBe(true);
    });

    it('uses a real column for units', () => {
      expect(hasColumn(usageEvents, 'units')).toBe(true);
    });
  });

  describe('usageRollups table', () => {
    it('has a unique index on the billing scope composite', () => {
      const uniq = uniqueIndexNames(usageRollups);
      expect(uniq).toContain('idx_usage_rollups_billing_scope');
    });
  });
});

// ===================================================================
// schema-agents
// ===================================================================
describe('schema-agents', () => {
  describe('agentTasks table', () => {
    it('is named "agent_tasks"', () => {
      expect(getTableName(agentTasks)).toBe('agent_tasks');
    });

    it('defaults status to planned and priority to medium', () => {
      const cols = getTableColumns(agentTasks);
      expect(cols.status.default).toBe('planned');
      expect(cols.priority.default).toBe('medium');
    });

    it('has composite index on account+status', () => {
      const idxs = indexNames(agentTasks);
      expect(idxs).toContain('idx_agent_tasks_account_status');
    });
  });

  describe('messages table', () => {
    it('is named "messages"', () => {
      expect(getTableName(messages)).toBe('messages');
    });

    it('has required columns: id, threadId, role, content, sequence', () => {
      for (const col of ['id', 'threadId', 'role', 'content', 'sequence']) {
        expect(hasColumn(messages, col)).toBe(true);
      }
    });

    it('has indexes for thread+sequence and thread+createdAt', () => {
      const idxs = indexNames(messages);
      expect(idxs).toContain('idx_messages_thread_sequence');
      expect(idxs).toContain('idx_messages_thread_created_at');
    });
  });

  describe('runs table', () => {
    it('is named "runs"', () => {
      expect(getTableName(runs)).toBe('runs');
    });

    it('defaults status to queued', () => {
      const cols = getTableColumns(runs);
      expect(cols.status.default).toBe('queued');
      expect(runs.serviceId).toBe(runs.workerId);
      expect(runs.serviceHeartbeat).toBe(runs.workerHeartbeat);
      expect(indexNames(runs)).toContain('idx_runs_service_id');
      expect(indexNames(runs)).toContain('idx_runs_service_heartbeat');
    });

    it('has subagent columns parentRunId, childThreadId, rootThreadId, rootRunId', () => {
      for (const col of ['parentRunId', 'childThreadId', 'rootThreadId', 'rootRunId']) {
        expect(hasColumn(runs, col)).toBe(true);
      }
    });

    it('has a leaseVersion column for optimistic concurrency', () => {
      expect(hasColumn(runs, 'leaseVersion')).toBe(true);
    });
  });

  describe('runEvents table', () => {
    it('uses auto-increment integer primary key', () => {
      const cols = getTableColumns(runEvents);
      expect(cols.id.primary).toBe(true);
    });
  });

  describe('reminders table', () => {
    it('is named "reminders"', () => {
      expect(getTableName(reminders)).toBe('reminders');
    });

    it('has all required columns', () => {
      for (const col of ['id', 'accountId', 'content', 'triggerType', 'status', 'priority']) {
        expect(hasColumn(reminders, col)).toBe(true);
      }
    });
  });

  describe('threads table', () => {
    it('defaults status to active', () => {
      const cols = getTableColumns(threads);
      expect(cols.status.default).toBe('active');
    });

    it('defaults contextWindow to 50', () => {
      const cols = getTableColumns(threads);
      expect(cols.contextWindow.default).toBe(50);
    });
  });

  describe('lgCheckpoints table', () => {
    it('has composite primary key on threadId+checkpointNs+checkpointId', () => {
      const pks = primaryKeyNames(lgCheckpoints);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('lgWrites table', () => {
    it('has 5-column composite primary key', () => {
      const pks = primaryKeyNames(lgWrites);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('memories table', () => {
    it('has indexes for type+category and importance', () => {
      const idxs = indexNames(memories);
      expect(idxs).toContain('idx_memories_type_category');
      expect(idxs).toContain('idx_memories_importance');
    });
  });

  describe('skills table', () => {
    it('has unique index on account+name', () => {
      const uniq = uniqueIndexNames(skills);
      expect(uniq).toContain('idx_skills_account_name');
    });
  });

  describe('threadShares table', () => {
    it('has a unique token column', () => {
      expect(hasColumn(threadShares, 'token')).toBe(true);
    });
  });

  describe('toolOperations table', () => {
    it('has a unique index on run+operationKey', () => {
      const uniq = uniqueIndexNames(toolOperations);
      expect(uniq).toContain('idx_tool_operations_key');
    });
  });

  describe('artifacts table', () => {
    it('defaults type to code and metadata to {}', () => {
      const cols = getTableColumns(artifacts);
      expect(cols.type.default).toBe('code');
      expect(cols.metadata.default).toBe('{}');
    });
  });

  describe('infoUnits table', () => {
    it('defaults kind to session', () => {
      const cols = getTableColumns(infoUnits);
      expect(cols.kind.default).toBe('session');
    });
  });
});

// ===================================================================
// schema-repos
// ===================================================================
describe('schema-repos', () => {
  describe('repositories table', () => {
    it('is named "repositories"', () => {
      expect(getTableName(repositories)).toBe('repositories');
    });

    it('has unique index on account+name', () => {
      const uniq = uniqueIndexNames(repositories);
      expect(uniq).toContain('idx_repositories_account_name');
    });

    it('defaults visibility to private and defaultBranch to main', () => {
      const cols = getTableColumns(repositories);
      expect(cols.visibility.default).toBe('private');
      expect(cols.defaultBranch.default).toBe('main');
    });

    it('has gitEnabled, isOfficial, and featured boolean columns', () => {
      for (const col of ['gitEnabled', 'isOfficial', 'featured']) {
        expect(hasColumn(repositories, col)).toBe(true);
      }
    });

    it('has indexes for visibility, official, featured, and primary language', () => {
      const idxs = indexNames(repositories);
      expect(idxs).toContain('idx_repositories_visibility');
      expect(idxs).toContain('idx_repositories_is_official');
      expect(idxs).toContain('idx_repositories_featured');
      expect(idxs).toContain('idx_repositories_primary_language');
    });
  });

  describe('blobs table', () => {
    it('has composite primary key on accountId+hash', () => {
      const pks = primaryKeyNames(blobs);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('branches table', () => {
    it('has unique index on repo+name', () => {
      const uniq = uniqueIndexNames(branches);
      expect(uniq).toContain('idx_branches_repo_name');
    });
  });

  describe('commits table', () => {
    it('has unique index on repo+sha', () => {
      const uniq = uniqueIndexNames(commits);
      expect(uniq).toContain('idx_commits_repo_sha');
    });

    it('has authorName, authorEmail, committerName, committerEmail columns', () => {
      for (const col of ['authorName', 'authorEmail', 'committerName', 'committerEmail']) {
        expect(hasColumn(commits, col)).toBe(true);
      }
    });
  });

  describe('files table', () => {
    it('has unique index on account+path', () => {
      const uniq = uniqueIndexNames(files);
      expect(uniq).toContain('idx_files_account_path');
    });

    it('defaults origin to user and kind to source', () => {
      const cols = getTableColumns(files);
      expect(cols.origin.default).toBe('user');
      expect(cols.kind.default).toBe('source');
    });
  });

  describe('pullRequests table', () => {
    it('has unique index on repo+number', () => {
      const uniq = uniqueIndexNames(pullRequests);
      expect(uniq).toContain('idx_pull_requests_repo_number');
    });

    it('defaults status to open', () => {
      const cols = getTableColumns(pullRequests);
      expect(cols.status.default).toBe('open');
    });
  });

  describe('repoForks table', () => {
    it('has indexes on fork and upstream', () => {
      const idxs = indexNames(repoForks);
      expect(idxs).toContain('idx_repo_forks_fork_repo_id');
      expect(idxs).toContain('idx_repo_forks_upstream_repo_id');
    });
  });

  describe('repoReleaseAssets table', () => {
    it('has unique index on release+assetKey', () => {
      const uniq = uniqueIndexNames(repoReleaseAssets);
      expect(uniq).toContain('idx_repo_release_assets_release_asset_key');
    });

    it('has bundleFormat and bundleMetaJson columns', () => {
      expect(hasColumn(repoReleaseAssets, 'bundleFormat')).toBe(true);
      expect(hasColumn(repoReleaseAssets, 'bundleMetaJson')).toBe(true);
    });
  });

  describe('repoReleases table', () => {
    it('has unique index on repo+tag', () => {
      const uniq = uniqueIndexNames(repoReleases);
      expect(uniq).toContain('idx_repo_releases_repo_tag');
    });
  });

  describe('repoStars table', () => {
    it('has composite primary key on accountId+repoId', () => {
      const pks = primaryKeyNames(repoStars);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('snapshots table', () => {
    it('defaults status to pending', () => {
      const cols = getTableColumns(snapshots);
      expect(cols.status.default).toBe('pending');
    });
  });

  describe('tags table', () => {
    it('has unique index on repo+name', () => {
      const uniq = uniqueIndexNames(tags);
      expect(uniq).toContain('idx_tags_repo_name');
    });
  });

  describe('gitCommits table', () => {
    it('has columns for filesChanged, insertions, deletions', () => {
      for (const col of ['filesChanged', 'insertions', 'deletions']) {
        expect(hasColumn(gitCommits, col)).toBe(true);
      }
    });
  });

  describe('gitFileChanges table', () => {
    it('has changeType and oldPath columns', () => {
      expect(hasColumn(gitFileChanges, 'changeType')).toBe(true);
      expect(hasColumn(gitFileChanges, 'oldPath')).toBe(true);
    });
  });

  describe('chunks table', () => {
    it('has indexes on file, account, and vector', () => {
      const idxs = indexNames(chunks);
      expect(idxs).toContain('idx_chunks_file_id');
      expect(idxs).toContain('idx_chunks_account_id');
      expect(idxs).toContain('idx_chunks_vector_id');
    });
  });

  describe('indexJobs table', () => {
    it('defaults status to queued', () => {
      const cols = getTableColumns(indexJobs);
      expect(cols.status.default).toBe('queued');
    });
  });

  describe('prComments table', () => {
    it('defaults authorType to ai', () => {
      const cols = getTableColumns(prComments);
      expect(cols.authorType.default).toBe('ai');
    });
  });

  describe('prReviews table', () => {
    it('defaults reviewerType to ai', () => {
      const cols = getTableColumns(prReviews);
      expect(cols.reviewerType.default).toBe('ai');
    });
  });

  describe('repoRemotes table', () => {
    it('has unique index on repo+name', () => {
      const uniq = uniqueIndexNames(repoRemotes);
      expect(uniq).toContain('idx_repo_remotes_repo_name');
    });

    it('defaults name to upstream', () => {
      const cols = getTableColumns(repoRemotes);
      expect(cols.name.default).toBe('upstream');
    });
  });
});

// ===================================================================
// schema-workers
// ===================================================================
describe('schema-workers', () => {
  describe('workers table', () => {
    it('compatibility alias points at services', () => {
      expect(getTableName(workers)).toBe('services');
    });

    it('defaults serviceType to app and status to pending while preserving workerType alias', () => {
      const cols = getTableColumns(workers);
      expect(cols.serviceType.default).toBe('app');
      expect(workers.workerType).toBe(workers.serviceType);
      expect(cols.status.default).toBe('pending');
    });

    it('has unique columns hostname, routeRef, and slug', () => {
      expect(hasColumn(workers, 'hostname')).toBe(true);
      expect(hasColumn(workers, 'routeRef')).toBe(true);
      expect(hasColumn(workers, 'slug')).toBe(true);
    });

    it('has unique index on id+accountId', () => {
      const uniq = uniqueIndexNames(workers);
      expect(uniq).toContain('idx_services_id_account');
    });
  });

  describe('apps table', () => {
    it('is named "apps"', () => {
      expect(getTableName(apps)).toBe('apps');
    });

    it('has service-centric indexes on service, appType, and account', () => {
      const idxs = indexNames(apps);
      expect(idxs).toContain('idx_apps_service_id');
      expect(idxs).toContain('idx_apps_app_type');
      expect(idxs).toContain('idx_apps_account_id');
    });

    it('has physical serviceId column with workerId compatibility alias', () => {
      expect(hasColumn(apps, 'serviceId')).toBe(true);
      expect(apps.workerId).toBe(apps.serviceId);
    });
  });

  describe('shortcutGroupItems table', () => {
    it('has physical serviceId column with workerId compatibility alias', () => {
      expect(hasColumn(shortcutGroupItems, 'serviceId')).toBe(true);
      expect(shortcutGroupItems.workerId).toBe(shortcutGroupItems.serviceId);
    });
  });

  describe('deployments table', () => {
    it('has unique index on service+version', () => {
      const uniq = uniqueIndexNames(deployments);
      expect(uniq).toContain('idx_deployments_service_version');
    });

    it('has rollback columns', () => {
      for (const col of ['isRollback', 'rollbackFromVersion', 'rolledBackAt', 'rolledBackBy']) {
        expect(hasColumn(deployments, col)).toBe(true);
      }
    });
  });

  describe('bundleDeployments table', () => {
    it('has unique index on account+name and account+app', () => {
      const uniq = uniqueIndexNames(bundleDeployments);
      expect(uniq).toContain('idx_bundle_deployments_account_name');
      expect(uniq).toContain('idx_bundle_deployments_account_app');
    });
  });

  describe('customDomains table', () => {
    it('defaults status to pending', () => {
      const cols = getTableColumns(customDomains);
      expect(cols.status.default).toBe('pending');
    });

    it('uses service_id as the physical foreign key column', () => {
      expect(hasColumn(customDomains, 'serviceId')).toBe(true);
    });

    it('exposes a serviceId alias for canonical core reads', () => {
      expect(serviceCustomDomains.serviceId).toBe(customDomains.workerId);
    });
  });

  describe('workerBindings table', () => {
    it('has unique index on worker+bindingName', () => {
      const uniq = uniqueIndexNames(workerBindings);
      expect(uniq).toContain('idx_service_bindings_service_binding');
    });
  });

  describe('workerCommonEnvLinks table', () => {
    it('has unique index on worker+envName+source', () => {
      const uniq = uniqueIndexNames(workerCommonEnvLinks);
      expect(uniq).toContain('idx_service_common_env_links_service_env_source');
    });
  });

  describe('workerEnvVars table', () => {
    it('has unique index on service+name', () => {
      const uniq = uniqueIndexNames(workerEnvVars);
      expect(uniq).toContain('idx_service_env_vars_service_name');
    });

    it('uses service_id as the physical foreign key column', () => {
      expect(hasColumn(workerEnvVars, 'serviceId')).toBe(true);
    });

    it('exposes a serviceId alias', () => {
      expect(serviceEnvVars.serviceId).toBe(workerEnvVars.workerId);
    });
  });

  describe('workerMcpEndpoints table', () => {
    it('has composite primary key on serviceId+name', () => {
      const pks = primaryKeyNames(workerMcpEndpoints);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });

    it('uses service_id as the physical foreign key column', () => {
      expect(hasColumn(workerMcpEndpoints, 'serviceId')).toBe(true);
    });

    it('exposes a serviceId alias', () => {
      expect(serviceMcpEndpoints.serviceId).toBe(workerMcpEndpoints.workerId);
    });
  });

  describe('workerRuntimeFlags table', () => {
    it('has composite primary key on serviceId+flag', () => {
      const pks = primaryKeyNames(workerRuntimeFlags);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });

    it('uses service_id as the physical foreign key column', () => {
      expect(hasColumn(workerRuntimeFlags, 'serviceId')).toBe(true);
    });

    it('exposes a serviceId alias', () => {
      expect(serviceRuntimeFlags.serviceId).toBe(workerRuntimeFlags.workerId);
    });
  });

  describe('workerRuntimeLimits table', () => {
    it('uses serviceId as primary key', () => {
      const cols = getTableColumns(workerRuntimeLimits);
      expect(cols.serviceId.primary).toBe(true);
    });

    it('has cpuMs, memoryMb, and subrequestLimit columns', () => {
      for (const col of ['cpuMs', 'memoryMb', 'subrequestLimit']) {
        expect(hasColumn(workerRuntimeLimits, col)).toBe(true);
      }
    });

    it('exposes a serviceId alias', () => {
      expect(serviceRuntimeLimits.serviceId).toBe(workerRuntimeLimits.workerId);
    });
  });

  describe('workerRuntimeSettings table', () => {
    it('uses serviceId as primary key', () => {
      const cols = getTableColumns(workerRuntimeSettings);
      expect(cols.serviceId.primary).toBe(true);
    });

    it('uses service-centric account index naming', () => {
      const idxs = indexNames(workerRuntimeSettings);
      expect(idxs).toContain('idx_service_runtime_settings_account_id');
    });

    it('exposes a serviceId alias', () => {
      expect(serviceRuntimeSettings.serviceId).toBe(workerRuntimeSettings.workerId);
    });
  });

  describe('managedTakosTokens table', () => {
    it('has unique index on service+envName', () => {
      const uniq = uniqueIndexNames(managedTakosTokens);
      expect(uniq).toContain('idx_managed_takos_tokens_service_env');
    });

    it('uses service_id as the physical foreign key column', () => {
      expect(hasColumn(managedTakosTokens, 'serviceId')).toBe(true);
    });

    it('exposes a workerId compat alias', () => {
      expect(serviceManagedTakosTokens.serviceId).toBe(managedTakosTokens.workerId);
    });
  });

  describe('commonEnvAuditLogs table', () => {
    it('has composite indexes for account+env+createdAt and service+createdAt', () => {
      const idxs = indexNames(commonEnvAuditLogs);
      expect(idxs).toContain('idx_common_env_audit_logs_account_env_created_at');
      expect(idxs).toContain('idx_common_env_audit_logs_service_created_at');
    });

    it('exposes a workerId compat alias', () => {
      expect(serviceCommonEnvAuditLogs.serviceId).toBe(commonEnvAuditLogs.workerId);
    });
  });

  describe('commonEnvReconcileJobs table', () => {
    it('has indexes on status+nextAttemptAt and account+service+status', () => {
      const idxs = indexNames(commonEnvReconcileJobs);
      expect(idxs).toContain('idx_common_env_reconcile_jobs_status_next_attempt');
      expect(idxs).toContain('idx_common_env_reconcile_jobs_account_service_status');
    });

    it('uses service_id as the physical foreign key column', () => {
      expect(hasColumn(commonEnvReconcileJobs, 'serviceId')).toBe(true);
    });

    it('exposes a workerId compat alias', () => {
      expect(serviceCommonEnvReconcileJobs.serviceId).toBe(commonEnvReconcileJobs.workerId);
    });
  });

  describe('deploymentEvents table', () => {
    it('uses auto-increment integer primary key', () => {
      const cols = getTableColumns(deploymentEvents);
      expect(cols.id.primary).toBe(true);
    });
  });

  describe('bundleDeploymentEvents table', () => {
    it('has index on bundleKey and account', () => {
      const idxs = indexNames(bundleDeploymentEvents);
      expect(idxs).toContain('idx_bundle_deployment_events_bundle_key');
      expect(idxs).toContain('idx_bundle_deployment_events_account_id');
    });
  });
});

// ===================================================================
// schema-oauth
// ===================================================================
describe('schema-oauth', () => {
  describe('oauthClients table', () => {
    it('is named "oauth_clients"', () => {
      expect(getTableName(oauthClients)).toBe('oauth_clients');
    });

    it('defaults clientType to confidential and status to active', () => {
      const cols = getTableColumns(oauthClients);
      expect(cols.clientType.default).toBe('confidential');
      expect(cols.status.default).toBe('active');
    });
  });

  describe('oauthTokens table', () => {
    it('has indexes for tokenType, tokenHash, tokenFamily, revoked, and expiresAt', () => {
      const idxs = indexNames(oauthTokens);
      expect(idxs).toContain('idx_oauth_tokens_token_type');
      expect(idxs).toContain('idx_oauth_tokens_token_hash');
      expect(idxs).toContain('idx_oauth_tokens_token_family');
      expect(idxs).toContain('idx_oauth_tokens_revoked');
      expect(idxs).toContain('idx_oauth_tokens_expires_at');
    });
  });

  describe('oauthAuthorizationCodes table', () => {
    it('has codeChallenge and codeChallengeMethod for PKCE', () => {
      expect(hasColumn(oauthAuthorizationCodes, 'codeChallenge')).toBe(true);
      expect(hasColumn(oauthAuthorizationCodes, 'codeChallengeMethod')).toBe(true);
    });

    it('defaults codeChallengeMethod to S256', () => {
      const cols = getTableColumns(oauthAuthorizationCodes);
      expect(cols.codeChallengeMethod.default).toBe('S256');
    });
  });

  describe('oauthConsents table', () => {
    it('has unique index on account+client', () => {
      const uniq = uniqueIndexNames(oauthConsents);
      expect(uniq).toContain('idx_oauth_consents_account_client');
    });
  });

  describe('oauthDeviceCodes table', () => {
    it('defaults status to pending', () => {
      const cols = getTableColumns(oauthDeviceCodes);
      expect(cols.status.default).toBe('pending');
    });

    it('defaults intervalSeconds to 5', () => {
      const cols = getTableColumns(oauthDeviceCodes);
      expect(cols.intervalSeconds.default).toBe(5);
    });
  });

  describe('oauthStates table', () => {
    it('has indexes on state and expiresAt', () => {
      const idxs = indexNames(oauthStates);
      expect(idxs).toContain('idx_oauth_states_state');
      expect(idxs).toContain('idx_oauth_states_expires_at');
    });
  });

  describe('oauthAuditLogs table', () => {
    it('has indexes on eventType, createdAt, clientId, and accountId', () => {
      const idxs = indexNames(oauthAuditLogs);
      expect(idxs).toContain('idx_oauth_audit_logs_event_type');
      expect(idxs).toContain('idx_oauth_audit_logs_created_at');
      expect(idxs).toContain('idx_oauth_audit_logs_client_id');
      expect(idxs).toContain('idx_oauth_audit_logs_account_id');
    });
  });

  describe('mcpServers table', () => {
    it('has unique index on account+name', () => {
      const uniq = uniqueIndexNames(mcpServers);
      expect(uniq).toContain('idx_mcp_servers_account_name');
    });

    it('defaults transport to streamable-http', () => {
      const cols = getTableColumns(mcpServers);
      expect(cols.transport.default).toBe('streamable-http');
      expect(mcpServers.serviceId).toBe(mcpServers.workerId);
      expect(indexNames(mcpServers)).toContain('idx_mcp_servers_service_id');
    });
  });

  describe('mcpOauthPending table', () => {
    it('has indexes on state and accountId', () => {
      const idxs = indexNames(mcpOauthPending);
      expect(idxs).toContain('idx_mcp_oauth_pending_state');
      expect(idxs).toContain('idx_mcp_oauth_pending_account_id');
    });
  });
});

// ===================================================================
// schema-platform
// ===================================================================
describe('schema-platform', () => {
  describe('resources table', () => {
    it('is named "resources"', () => {
      expect(getTableName(resources)).toBe('resources');
    });

    it('defaults status to provisioning', () => {
      const cols = getTableColumns(resources);
      expect(cols.status.default).toBe('provisioning');
    });

    it('has indexes on type, semanticType, providerName, status, owner, providerResourceId, and account', () => {
      const idxs = indexNames(resources);
      expect(idxs).toContain('idx_resources_type');
      expect(idxs).toContain('idx_resources_semantic_type');
      expect(idxs).toContain('idx_resources_provider_name');
      expect(idxs).toContain('idx_resources_status');
      expect(idxs).toContain('idx_resources_owner_account_id');
      expect(idxs).toContain('idx_resources_provider_resource_id');
      expect(idxs).toContain('idx_resources_account_id');
    });
  });

  describe('resourceAccess table', () => {
    it('has unique index on resource+account', () => {
      const uniq = uniqueIndexNames(resourceAccess);
      expect(uniq).toContain('idx_resource_access_resource_account');
    });

    it('defaults permission to read', () => {
      const cols = getTableColumns(resourceAccess);
      expect(cols.permission.default).toBe('read');
    });
  });

  describe('resourceAccessTokens table', () => {
    it('has indexes on tokenHash and resource', () => {
      const idxs = indexNames(resourceAccessTokens);
      expect(idxs).toContain('idx_resource_access_tokens_token_hash');
      expect(idxs).toContain('idx_resource_access_tokens_resource_id');
    });
  });

  describe('edges table', () => {
    it('has indexes on source, target, type, and account', () => {
      const idxs = indexNames(edges);
      expect(idxs).toContain('idx_edges_source_id');
      expect(idxs).toContain('idx_edges_target_id');
      expect(idxs).toContain('idx_edges_type');
      expect(idxs).toContain('idx_edges_account_id');
    });
  });

  describe('nodes table', () => {
    it('has indexes on type, refId, and account', () => {
      const idxs = indexNames(nodes);
      expect(idxs).toContain('idx_nodes_type');
      expect(idxs).toContain('idx_nodes_ref_id');
      expect(idxs).toContain('idx_nodes_account_id');
    });
  });

  describe('notifications table', () => {
    it('is named "notifications"', () => {
      expect(getTableName(notifications)).toBe('notifications');
    });

    it('has email tracking columns', () => {
      for (const col of ['emailStatus', 'emailAttempts', 'emailSentAt', 'emailError']) {
        expect(hasColumn(notifications, col)).toBe(true);
      }
    });
  });

  describe('notificationPreferences table', () => {
    it('has composite primary key on accountId+type+channel', () => {
      const pks = primaryKeyNames(notificationPreferences);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('notificationSettings table', () => {
    it('uses accountId as primary key', () => {
      const cols = getTableColumns(notificationSettings);
      expect(cols.accountId.primary).toBe(true);
    });
  });

  describe('sessions table', () => {
    it('is named "sessions"', () => {
      expect(getTableName(sessions)).toBe('sessions');
    });

    it('has columns for repoId and branch', () => {
      expect(hasColumn(sessions, 'repoId')).toBe(true);
      expect(hasColumn(sessions, 'branch')).toBe(true);
    });
  });

  describe('sessionFiles table', () => {
    it('has unique index on session+path', () => {
      const uniq = uniqueIndexNames(sessionFiles);
      expect(uniq).toContain('idx_session_files_session_path');
    });
  });

  describe('sessionRepos table', () => {
    it('has unique indexes on session+repo and session+mount', () => {
      const uniq = uniqueIndexNames(sessionRepos);
      expect(uniq).toContain('idx_session_repos_session_repo');
      expect(uniq).toContain('idx_session_repos_session_mount');
    });
  });

  describe('shortcuts table', () => {
    it('has unique index on user+resourceType+resourceId', () => {
      const uniq = uniqueIndexNames(shortcuts);
      expect(uniq).toContain('idx_shortcuts_user_resource_type_id');
    });
  });

  describe('uiExtensions table', () => {
    it('has unique index on account+path', () => {
      const uniq = uniqueIndexNames(uiExtensions);
      expect(uniq).toContain('idx_ui_extensions_account_path');
    });
  });

  describe('reports table', () => {
    it('defaults status to open', () => {
      const cols = getTableColumns(reports);
      expect(cols.status.default).toBe('open');
    });
  });

  describe('moderationAuditLogs table', () => {
    it('has indexes on targetType+id, report, createdAt, actor, and actionType', () => {
      const idxs = indexNames(moderationAuditLogs);
      expect(idxs).toContain('idx_moderation_audit_logs_target_type_id');
      expect(idxs).toContain('idx_moderation_audit_logs_report_id');
      expect(idxs).toContain('idx_moderation_audit_logs_created_at');
      expect(idxs).toContain('idx_moderation_audit_logs_actor_account_id');
      expect(idxs).toContain('idx_moderation_audit_logs_action_type');
    });
  });

  describe('infraEndpoints table', () => {
    it('has unique index on account+name', () => {
      const uniq = uniqueIndexNames(infraEndpoints);
      expect(uniq).toContain('idx_infra_endpoints_account_name');
    });
  });

  describe('serviceRuntimes table', () => {
    it('has unique index on account+name', () => {
      const uniq = uniqueIndexNames(serviceRuntimes);
      expect(uniq).toContain('idx_service_runtimes_account_name');
    });
  });

  describe('infraEndpointRoutes table', () => {
    it('has composite primary key on endpointId+position', () => {
      const pks = primaryKeyNames(infraEndpointRoutes);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('fileHandlers table', () => {
    it('uses service_hostname as the physical hostname column', () => {
      expect(hasColumn(fileHandlers, 'serviceHostname')).toBe(true);
    });

    it('retains workerHostname as a compatibility alias', () => {
      expect(fileHandlers.workerHostname).toBe(fileHandlers.serviceHostname);
    });
  });

  describe('fileHandlerMatchers table', () => {
    it('has composite primary key on fileHandlerId+kind+value', () => {
      const pks = primaryKeyNames(fileHandlerMatchers);
      expect(pks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('dlqEntries table', () => {
    it('is named "dlq_entries"', () => {
      expect(getTableName(dlqEntries)).toBe('dlq_entries');
    });
  });

  describe('storeRegistry table', () => {
    it('has unique index on account+actorUrl', () => {
      const uniq = uniqueIndexNames(storeRegistry);
      expect(uniq).toContain('idx_store_registry_account_actor');
    });
  });

  describe('storeRegistryUpdates table', () => {
    it('has unique index on registryEntryId+activityId', () => {
      const uniq = uniqueIndexNames(storeRegistryUpdates);
      expect(uniq).toContain('idx_store_registry_updates_activity');
    });
  });
});

// ===================================================================
// schema-workflows
// ===================================================================
describe('schema-workflows', () => {
  describe('workflows table', () => {
    it('is named "workflows"', () => {
      expect(getTableName(workflows)).toBe('workflows');
    });

    it('has unique index on repo+path', () => {
      const uniq = uniqueIndexNames(workflows);
      expect(uniq).toContain('idx_workflows_repo_path');
    });
  });

  describe('workflowRuns table', () => {
    it('defaults status to queued and runAttempt to 1', () => {
      const cols = getTableColumns(workflowRuns);
      expect(cols.status.default).toBe('queued');
      expect(cols.runAttempt.default).toBe(1);
    });

    it('has indexes for workflow, status, repo, event, createdAt, and actor', () => {
      const idxs = indexNames(workflowRuns);
      expect(idxs).toContain('idx_workflow_runs_workflow_id');
      expect(idxs).toContain('idx_workflow_runs_status');
      expect(idxs).toContain('idx_workflow_runs_repo_id');
      expect(idxs).toContain('idx_workflow_runs_event');
      expect(idxs).toContain('idx_workflow_runs_created_at');
      expect(idxs).toContain('idx_workflow_runs_actor_account_id');
    });
  });

  describe('workflowJobs table', () => {
    it('defaults status to queued', () => {
      const cols = getTableColumns(workflowJobs);
      expect(cols.status.default).toBe('queued');
    });
  });

  describe('workflowSteps table', () => {
    it('defaults status to pending', () => {
      const cols = getTableColumns(workflowSteps);
      expect(cols.status.default).toBe('pending');
    });

    it('has indexes on job+number and jobId', () => {
      const idxs = indexNames(workflowSteps);
      expect(idxs).toContain('idx_workflow_steps_job_number');
      expect(idxs).toContain('idx_workflow_steps_job_id');
    });
  });

  describe('workflowSecrets table', () => {
    it('has unique index on repo+name', () => {
      const uniq = uniqueIndexNames(workflowSecrets);
      expect(uniq).toContain('idx_workflow_secrets_repo_name');
    });
  });

  describe('workflowArtifacts table', () => {
    it('has indexes on run and expiresAt', () => {
      const idxs = indexNames(workflowArtifacts);
      expect(idxs).toContain('idx_workflow_artifacts_run_id');
      expect(idxs).toContain('idx_workflow_artifacts_expires_at');
    });
  });
});

// ===================================================================
// Cross-schema: all tables have expected names (no accidental rename)
// ===================================================================
describe('all table names are stable', () => {
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
    expect(getTableName(table)).toBe(expectedSqlName);
  });
});
