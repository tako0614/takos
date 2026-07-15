import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAtColumn, timestamps } from "./schema-utils.ts";
import { accounts } from "./schema-accounts.ts";
import { runs } from "./schema-agents.ts";

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

// 56. NotificationPreference
export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    type: text("type").notNull(),
    channel: text("channel").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.accountId, table.type, table.channel] }),
    idxType: index("idx_notification_preferences_type").on(table.type),
    idxChannel: index("idx_notification_preferences_channel").on(table.channel),
    idxAccount: index("idx_notification_preferences_account_id").on(
      table.accountId,
    ),
  }),
);

// 57. NotificationSettings
export const notificationSettings = sqliteTable("notification_settings", {
  accountId: text("account_id").primaryKey(),
  mutedUntil: text("muted_until"),
  ...timestamps,
});

// 57a. NotificationPusher
export const notificationPushers = sqliteTable(
  "notification_pushers",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    product: text("product"),
    scope: text("scope"),
    kind: text("kind").notNull(),
    appId: text("app_id").notNull(),
    pushkey: text("pushkey").notNull(),
    pushkeyHash: text("pushkey_hash").notNull(),
    appDisplayName: text("app_display_name"),
    deviceDisplayName: text("device_display_name"),
    profileTag: text("profile_tag"),
    lang: text("lang"),
    gatewayUrl: text("gateway_url").notNull(),
    data: text("data").notNull().default("{}"),
    ...timestamps,
    lastSeenAt: text("last_seen_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    uniqAppPushkey: uniqueIndex("idx_notification_pushers_app_pushkey").on(
      table.appId,
      table.pushkeyHash,
    ),
    idxAccount: index("idx_notification_pushers_account_id").on(
      table.accountId,
    ),
    idxProduct: index("idx_notification_pushers_product").on(table.product),
    idxLastSeen: index("idx_notification_pushers_last_seen_at").on(
      table.lastSeenAt,
    ),
  }),
);

// 58. Notification
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientAccountId: text("recipient_account_id")
      .notNull()
      .references(() => accounts.id),
    accountId: text("account_id").references(() => accounts.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: text("data").notNull().default("{}"),
    readAt: text("read_at"),
    ...createdAtColumn,
    emailStatus: text("email_status").notNull().default("skipped"),
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailSentAt: text("email_sent_at"),
    emailError: text("email_error"),
  },
  (table) => ({
    idxType: index("idx_notifications_type").on(table.type),
    idxRecipientReadAt: index("idx_notifications_recipient_read_at").on(
      table.recipientAccountId,
      table.readAt,
    ),
    idxRecipient: index("idx_notifications_recipient_account_id").on(
      table.recipientAccountId,
    ),
    idxRecipientCreatedAt: index("idx_notifications_recipient_created_at").on(
      table.recipientAccountId,
      table.createdAt,
    ),
    idxAccount: index("idx_notifications_account_id").on(table.accountId),
  }),
);

// 58a. Durable event-id-only notification push outbox
export const notificationPushOutbox = sqliteTable(
  "notification_push_outbox",
  {
    notificationId: text("notification_id")
      .primaryKey()
      .references(() => notifications.id, { onDelete: "cascade" }),
    deliveryStatus: text("delivery_status").notNull().default("queued"),
    claimToken: text("claim_token"),
    claimedAt: text("claimed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => ({
    idxStatusClaimedAt: index(
      "idx_notification_push_outbox_status_claimed_at",
    ).on(table.deliveryStatus, table.claimedAt),
  }),
);

// 58b. Durable terminal Run notification outbox
export const runNotificationOutbox = sqliteTable(
  "run_notification_outbox",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    completionKey: text("completion_key").notNull(),
    runStatus: text("run_status").notNull(),
    deliveryStatus: text("delivery_status").notNull().default("queued"),
    claimToken: text("claim_token"),
    claimedAt: text("claimed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => ({
    uniqCompletionKey: uniqueIndex(
      "idx_run_notification_outbox_completion_key",
    ).on(table.completionKey),
    idxRun: index("idx_run_notification_outbox_run_id").on(table.runId),
    idxStatusClaimedAt: index(
      "idx_run_notification_outbox_status_claimed_at",
    ).on(table.deliveryStatus, table.claimedAt),
  }),
);

// 86. SessionFile
export const sessionFiles = sqliteTable(
  "session_files",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    path: text("path").notNull(),
    hash: text("hash").notNull(),
    size: integer("size").notNull().default(0),
    operation: text("operation").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    uniqSessionPath: uniqueIndex("idx_session_files_session_path").on(
      table.sessionId,
      table.path,
    ),
    idxSession: index("idx_session_files_session_id").on(table.sessionId),
  }),
);

// 87. SessionRepo
export const sessionRepos = sqliteTable(
  "session_repos",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    repoId: text("repo_id").notNull(),
    branch: text("branch"),
    mountPath: text("mount_path").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    ...createdAtColumn,
  },
  (table) => ({
    uniqSessionRepo: uniqueIndex("idx_session_repos_session_repo").on(
      table.sessionId,
      table.repoId,
    ),
    uniqSessionMount: uniqueIndex("idx_session_repos_session_mount").on(
      table.sessionId,
      table.mountPath,
    ),
    idxSessionPrimary: index("idx_session_repos_session_primary").on(
      table.sessionId,
      table.isPrimary,
    ),
    idxSession: index("idx_session_repos_session_id").on(table.sessionId),
    idxRepo: index("idx_session_repos_repo_id").on(table.repoId),
  }),
);

// 88. Session
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    userAccountId: text("user_account_id").references(() => accounts.id),
    baseSnapshotId: text("base_snapshot_id").notNull(),
    headSnapshotId: text("head_snapshot_id"),
    status: text("status").notNull(),
    lastHeartbeat: text("last_heartbeat"),
    repoId: text("repo_id"),
    branch: text("branch"),
    ...timestamps,
  },
  (table) => ({
    idxUserAccount: index("idx_sessions_user_account_id").on(
      table.userAccountId,
    ),
    idxStatus: index("idx_sessions_status").on(table.status),
    idxRepo: index("idx_sessions_repo_id").on(table.repoId),
    idxLastHeartbeat: index("idx_sessions_last_heartbeat").on(
      table.lastHeartbeat,
    ),
    idxAccount: index("idx_sessions_account_id").on(table.accountId),
  }),
);
