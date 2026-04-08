import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps, updatedAtColumn } from './schema-utils.ts';

// 1. AccountBlock
export const accountBlocks = sqliteTable('account_blocks', {
  blockerAccountId: text('blocker_account_id').notNull(),
  blockedAccountId: text('blocked_account_id').notNull(),
  ...createdAtColumn,
}, (table) => ({
  pk: primaryKey({ columns: [table.blockerAccountId, table.blockedAccountId] }),
  idxBlocker: index('idx_account_blocks_blocker_account_id').on(table.blockerAccountId),
  idxBlocked: index('idx_account_blocks_blocked_account_id').on(table.blockedAccountId),
}));

// 2. AccountEnvVar
export const accountEnvVars = sqliteTable('account_env_vars', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  valueEncrypted: text('value_encrypted').notNull(),
  isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
}, (table) => ({
  uniqAccountName: uniqueIndex('idx_account_env_vars_account_id_name').on(table.accountId, table.name),
  idxAccount: index('idx_account_env_vars_account_id').on(table.accountId),
}));

// 3. AccountFollowRequest
export const accountFollowRequests = sqliteTable('account_follow_requests', {
  id: text('id').primaryKey(),
  requesterAccountId: text('requester_account_id').notNull(),
  targetAccountId: text('target_account_id').notNull(),
  status: text('status').notNull().default('pending'),
  ...createdAtColumn,
  respondedAt: text('responded_at'),
  ...updatedAtColumn,
}, (table) => ({
  uniqRequesterTarget: uniqueIndex('idx_account_follow_requests_requester_target').on(table.requesterAccountId, table.targetAccountId),
  idxTargetStatus: index('idx_account_follow_requests_target_status').on(table.targetAccountId, table.status),
  idxRequester: index('idx_account_follow_requests_requester').on(table.requesterAccountId),
  idxCreatedAt: index('idx_account_follow_requests_created_at').on(table.createdAt),
}));

// 4. AccountFollow
export const accountFollows = sqliteTable('account_follows', {
  followerAccountId: text('follower_account_id').notNull(),
  followingAccountId: text('following_account_id').notNull(),
  ...createdAtColumn,
}, (table) => ({
  pk: primaryKey({ columns: [table.followerAccountId, table.followingAccountId] }),
  idxFollowing: index('idx_account_follows_following_account_id').on(table.followingAccountId),
  idxFollower: index('idx_account_follows_follower_account_id').on(table.followerAccountId),
}));

// 5. AccountMembership
export const accountMemberships = sqliteTable('account_memberships', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  memberId: text('member_id').notNull(),
  role: text('role').notNull().default('viewer'),
  status: text('status').notNull().default('active'),
  ...updatedAtColumn,
  ...createdAtColumn,
}, (table) => ({
  uniqAccountMember: uniqueIndex('idx_account_memberships_account_member').on(table.accountId, table.memberId),
  idxMember: index('idx_account_memberships_member_id').on(table.memberId),
  idxAccount: index('idx_account_memberships_account_id').on(table.accountId),
}));

// 6. AccountMetadata
export const accountMetadata = sqliteTable('account_metadata', {
  accountId: text('account_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  ...timestamps,
}, (table) => ({
  pk: primaryKey({ columns: [table.accountId, table.key] }),
  idxKey: index('idx_account_metadata_key').on(table.key),
}));

// 7. AccountModeration
export const accountModeration = sqliteTable('account_moderation', {
  accountId: text('account_id').primaryKey(),
  status: text('status').notNull().default('active'),
  suspendedUntil: text('suspended_until'),
  warnCount: integer('warn_count').notNull().default(0),
  lastWarnAt: text('last_warn_at'),
  bannedAt: text('banned_at'),
  reason: text('reason'),
  ...updatedAtColumn,
}, (table) => ({
  idxSuspendedUntil: index('idx_account_moderation_suspended_until').on(table.suspendedUntil),
  idxStatus: index('idx_account_moderation_status').on(table.status),
}));

// 8. AccountMute
export const accountMutes = sqliteTable('account_mutes', {
  muterAccountId: text('muter_account_id').notNull(),
  mutedAccountId: text('muted_account_id').notNull(),
  ...createdAtColumn,
}, (table) => ({
  pk: primaryKey({ columns: [table.muterAccountId, table.mutedAccountId] }),
  idxMuter: index('idx_account_mutes_muter_account_id').on(table.muterAccountId),
  idxMuted: index('idx_account_mutes_muted_account_id').on(table.mutedAccountId),
}));

// 9. AccountSettings
export const accountSettings = sqliteTable('account_settings', {
  accountId: text('account_id').primaryKey(),
  setupCompleted: integer('setup_completed', { mode: 'boolean' }).notNull().default(false),
  autoUpdateEnabled: integer('auto_update_enabled', { mode: 'boolean' }).notNull().default(true),
  privateAccount: integer('private_account', { mode: 'boolean' }).notNull().default(false),
  activityVisibility: text('activity_visibility').notNull().default('public'),
  ...timestamps,
});

// 10. AccountStats
export const accountStats = sqliteTable('account_stats', {
  accountId: text('account_id').primaryKey(),
  fileCount: integer('file_count').notNull().default(0),
  totalSizeBytes: integer('total_size_bytes').notNull().default(0),
  snapshotCount: integer('snapshot_count').notNull().default(0),
  blobCount: integer('blob_count').notNull().default(0),
  lastCalculatedAt: text('last_calculated_at').notNull().$defaultFn(() => new Date().toISOString()),
  ...updatedAtColumn,
}, (table) => ({
  idxTotalSizeBytes: index('idx_account_stats_total_size_bytes').on(table.totalSizeBytes),
  idxFileCount: index('idx_account_stats_file_count').on(table.fileCount),
}));

// 11. AccountStorageFile
export const accountStorageFiles = sqliteTable('account_storage_files', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  path: text('path').notNull(),
  type: text('type').notNull(),
  size: integer('size').notNull().default(0),
  mimeType: text('mime_type'),
  r2Key: text('r2_key'),
  sha256: text('sha256'),
  uploadedByAccountId: text('uploaded_by_account_id'),
  ...timestamps,
}, (table) => ({
  uniqAccountPath: uniqueIndex('idx_account_storage_files_account_path').on(table.accountId, table.path),
  idxParent: index('idx_account_storage_files_parent_id').on(table.parentId),
  idxAccountType: index('idx_account_storage_files_account_type').on(table.accountId, table.type),
  idxAccountParentType: index('idx_account_storage_files_account_parent_type').on(table.accountId, table.parentId, table.type),
}));

// 12. Account
//
// NOTE: The baseline migration `0001_baseline.sql` also creates two zombie
// columns and three zombie indexes that are *not* declared here:
//   - `google_sub TEXT` + `accounts_google_sub_key` UNIQUE +
//     `accounts_google_sub_idx`
//   - `takos_auth_id TEXT` + `accounts_takos_auth_id_idx`
// These were superseded by the `auth_identities` table (added later in the
// same baseline) but never dropped. They are still present at the D1 level
// and the local-platform sqlite-rewrite layer
// (`local-platform/d1-sql-rewrite.ts`) explicitly filters out the index
// creates. New code should use `authIdentities` for OAuth provider linking.
//
// `security_posture` also has a CHECK constraint
// (`CHECK (security_posture IN ('standard', 'restricted_egress'))`) declared
// in migration 0004 but not representable in drizzle. Application-level
// validation must enforce the same constraint when writing.
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull().default('active'),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  picture: text('picture'),
  bio: text('bio'),
  email: text('email').unique(),
  trustTier: text('trust_tier').notNull().default('new'),
  setupCompleted: integer('setup_completed', { mode: 'boolean' }).notNull().default(false),
  defaultRepositoryId: text('default_repository_id'),
  headSnapshotId: text('head_snapshot_id'),
  aiModel: text('ai_model').default('gpt-5.4-nano'),
  aiProvider: text('ai_provider').default('openai'),
  securityPosture: text('security_posture').notNull().default('standard'),
  ownerAccountId: text('owner_account_id'),
  ...timestamps,
}, (table) => ({
  idxType: index('idx_accounts_type').on(table.type),
  idxSlug: index('idx_accounts_slug').on(table.slug),
  idxOwner: index('idx_accounts_owner_account_id').on(table.ownerAccountId),
  idxEmail: index('idx_accounts_email').on(table.email),
  idxDefaultRepo: index('idx_accounts_default_repository_id').on(table.defaultRepositoryId),
}));

// 12b. AuthIdentity
export const authIdentities = sqliteTable('auth_identities', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => accounts.id),
  provider: text('provider').notNull(),
  providerSub: text('provider_sub').notNull(),
  emailSnapshot: text('email_snapshot'),
  emailKind: text('email_kind').notNull().default('unknown'),
  linkedAt: text('linked_at').notNull(),
  lastLoginAt: text('last_login_at').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
}, (table) => [
  uniqueIndex('idx_auth_identities_provider_sub').on(table.provider, table.providerSub),
  index('idx_auth_identities_user_id').on(table.userId),
]);
