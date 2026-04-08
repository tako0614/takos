import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps } from './schema-utils.ts';
import { accounts } from './schema-accounts.ts';

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

// 56. NotificationPreference
export const notificationPreferences = sqliteTable('notification_preferences', {
  accountId: text('account_id').notNull().references(() => accounts.id),
  type: text('type').notNull(),
  channel: text('channel').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
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
  ...timestamps,
});

// 58. Notification
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  recipientAccountId: text('recipient_account_id').notNull().references(() => accounts.id),
  accountId: text('account_id').references(() => accounts.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  data: text('data').notNull().default('{}'),
  readAt: text('read_at'),
  ...createdAtColumn,
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

// 86. SessionFile
export const sessionFiles = sqliteTable('session_files', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  path: text('path').notNull(),
  hash: text('hash').notNull(),
  size: integer('size').notNull().default(0),
  operation: text('operation').notNull(),
  ...createdAtColumn,
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
  ...createdAtColumn,
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
  accountId: text('account_id').notNull().references(() => accounts.id),
  userAccountId: text('user_account_id').references(() => accounts.id),
  baseSnapshotId: text('base_snapshot_id').notNull(),
  headSnapshotId: text('head_snapshot_id'),
  status: text('status').notNull(),
  lastHeartbeat: text('last_heartbeat'),
  repoId: text('repo_id'),
  branch: text('branch'),
  ...timestamps,
}, (table) => ({
  idxUserAccount: index('idx_sessions_user_account_id').on(table.userAccountId),
  idxStatus: index('idx_sessions_status').on(table.status),
  idxRepo: index('idx_sessions_repo_id').on(table.repoId),
  idxLastHeartbeat: index('idx_sessions_last_heartbeat').on(table.lastHeartbeat),
  idxAccount: index('idx_sessions_account_id').on(table.accountId),
}));
