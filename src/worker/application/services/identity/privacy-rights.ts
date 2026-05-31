import { desc, eq, inArray } from "drizzle-orm";

import type { User } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { generateId } from "../../../shared/utils/index.ts";
import {
  accountMemberships,
  accountMetadata,
  accounts,
  accountSettings,
  appUsageEvents,
  appUsageRollups,
  authIdentities,
  authSessions,
  getDb,
  memories,
  messages,
  notifications,
  repositories,
  runs,
  threads,
} from "../../../infra/db/index.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";

const DELETION_REQUEST_METADATA_KEY = "privacy.deletion_request";
const PRIVACY_RIGHTS_VERSION = "2026-05-07";

export type PrivacyRequestStatus = {
  readonly status: "none" | "pending";
  readonly requested_at?: string;
  readonly request_id?: string;
};

export type PrivacyAccessSummary = {
  readonly version: string;
  readonly subject: {
    readonly id: string;
    readonly email: string;
    readonly username: string;
    readonly display_name: string;
  };
  readonly request_status: PrivacyRequestStatus;
  readonly available_actions: Array<{
    readonly type: "access" | "export" | "deletion";
    readonly method: string;
    readonly path: string;
  }>;
  readonly lawful_basis_url: string;
  readonly privacy_policy_url: string;
};

export type DataSubjectExport = PrivacyAccessSummary & {
  readonly exported_at: string;
  readonly account: unknown;
  readonly settings: unknown;
  readonly metadata: unknown[];
  readonly memberships: unknown[];
  readonly auth: {
    readonly identities: unknown[];
    readonly sessions: unknown[];
  };
  readonly app_usage: {
    readonly events: unknown[];
    readonly rollups: unknown[];
  };
  readonly repositories: unknown[];
  readonly threads: unknown[];
  readonly messages: unknown[];
  readonly runs: unknown[];
  readonly memories: unknown[];
  readonly notifications: unknown[];
};

export type DeletionRequestResult = {
  readonly request_id: string;
  readonly status: "pending";
  readonly requested_at: string;
  readonly account_status: "pending_deletion";
  readonly revoked: {
    readonly auth_sessions: number;
  };
};

type DeletionRequestOptions = {
  readonly reason?: string | null;
};

function parseDeletionRequestStatus(
  rows: Array<{ key: string; value: string }>,
): PrivacyRequestStatus {
  const row = rows.find((item) => item.key === DELETION_REQUEST_METADATA_KEY);
  if (!row) return { status: "none" };

  try {
    const parsed = JSON.parse(row.value) as {
      status?: string;
      requested_at?: string;
      request_id?: string;
    };
    if (
      parsed.status === "pending" &&
      typeof parsed.requested_at === "string" &&
      typeof parsed.request_id === "string"
    ) {
      return {
        status: "pending",
        requested_at: parsed.requested_at,
        request_id: parsed.request_id,
      };
    }
  } catch {
    // Malformed metadata should not break the rights endpoint.
  }

  return { status: "none" };
}

function normalizeSubject(user: User) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.name,
  };
}

function safeReason(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 1000);
}

function sanitizeAuthIdentities(
  rows: Array<typeof authIdentities.$inferSelect>,
) {
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    provider_sub: row.providerSub,
    email_snapshot: row.emailSnapshot,
    email_kind: row.emailKind,
    linked_at: row.linkedAt,
    last_login_at: row.lastLoginAt,
  }));
}

async function readPrivacyMetadata(
  d1: SqlDatabaseBinding,
  accountId: string,
): Promise<
  Array<{ key: string; value: string; created_at: string; updated_at: string }>
> {
  const db = getDb(d1);
  const rows = await db.select({
    key: accountMetadata.key,
    value: accountMetadata.value,
    created_at: accountMetadata.createdAt,
    updated_at: accountMetadata.updatedAt,
  }).from(accountMetadata).where(eq(accountMetadata.accountId, accountId))
    .all();
  return rows;
}

export async function getPrivacyAccessSummary(
  d1: SqlDatabaseBinding,
  user: User,
): Promise<PrivacyAccessSummary> {
  const metadata = await readPrivacyMetadata(d1, user.id);
  return {
    version: PRIVACY_RIGHTS_VERSION,
    subject: normalizeSubject(user),
    request_status: parseDeletionRequestStatus(metadata),
    available_actions: [
      {
        type: "access",
        method: "GET",
        path: "/api/me/privacy/access",
      },
      {
        type: "export",
        method: "GET",
        path: "/api/me/privacy/export",
      },
      {
        type: "deletion",
        method: "POST",
        path: "/api/me/privacy/deletion-requests",
      },
    ],
    lawful_basis_url: "/legal/privacy-rights#lawful-bases",
    privacy_policy_url: "/privacy",
  };
}

export async function buildDataSubjectExport(
  d1: SqlDatabaseBinding,
  user: User,
): Promise<DataSubjectExport> {
  const db = getDb(d1);
  const accountRows = await db.select().from(accounts).where(
    eq(accounts.id, user.id),
  ).all();
  const metadata = await readPrivacyMetadata(d1, user.id);
  const settings = await db.select().from(accountSettings).where(
    eq(accountSettings.accountId, user.id),
  ).all();
  const memberships = await db.select().from(accountMemberships).where(
    eq(accountMemberships.memberId, user.id),
  ).all();
  const identityRows = await db.select().from(authIdentities).where(
    eq(authIdentities.userId, user.id),
  ).all();
  const sessionRows = await db.select({
    id: authSessions.id,
    user_agent: authSessions.userAgent,
    ip_address: authSessions.ipAddress,
    expires_at: authSessions.expiresAt,
    created_at: authSessions.createdAt,
  }).from(authSessions).where(eq(authSessions.accountId, user.id)).all();
  const appUsageEventRows = await db.select().from(appUsageEvents).where(
    eq(appUsageEvents.ownerAccountId, user.id),
  ).orderBy(desc(appUsageEvents.createdAt)).all();
  const appUsageRollupRows = await db.select().from(appUsageRollups).where(
    eq(appUsageRollups.ownerAccountId, user.id),
  ).orderBy(desc(appUsageRollups.updatedAt)).all();
  const repositoryRows = await db.select().from(repositories).where(
    eq(repositories.accountId, user.id),
  ).orderBy(desc(repositories.updatedAt)).all();
  const threadRows = await db.select().from(threads).where(
    eq(threads.accountId, user.id),
  ).orderBy(desc(threads.updatedAt)).all();
  const threadIds = threadRows.map((thread) => thread.id);
  const messageRows = threadIds.length > 0
    ? await db.select().from(messages).where(
      inArray(messages.threadId, threadIds),
    )
      .orderBy(messages.threadId, messages.sequence)
      .all()
    : [];
  const runRows = threadIds.length > 0
    ? await db.select().from(runs).where(inArray(runs.threadId, threadIds))
      .orderBy(desc(runs.createdAt))
      .all()
    : [];
  const memoryRows = await db.select().from(memories).where(
    eq(memories.accountId, user.id),
  ).orderBy(desc(memories.updatedAt)).all();
  const notificationRows = await db.select().from(notifications).where(
    eq(notifications.recipientAccountId, user.id),
  ).orderBy(desc(notifications.createdAt)).all();

  return {
    ...(await getPrivacyAccessSummary(d1, user)),
    exported_at: new Date().toISOString(),
    account: accountRows[0] ?? null,
    settings,
    metadata,
    memberships,
    auth: {
      identities: sanitizeAuthIdentities(identityRows),
      sessions: sessionRows,
    },
    app_usage: {
      events: appUsageEventRows,
      rollups: appUsageRollupRows,
    },
    repositories: repositoryRows,
    threads: threadRows,
    messages: messageRows,
    runs: runRows,
    memories: memoryRows,
    notifications: notificationRows,
  };
}

async function upsertDeletionRequestMetadata(
  d1: SqlDatabaseBinding,
  accountId: string,
  value: string,
  timestamp: string,
): Promise<void> {
  await d1.prepare(
    `INSERT INTO account_metadata
       (account_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).bind(accountId, DELETION_REQUEST_METADATA_KEY, value, timestamp, timestamp)
    .run();
}

export async function requestAccountDeletion(
  d1: SqlDatabaseBinding,
  user: User,
  options: DeletionRequestOptions = {},
): Promise<DeletionRequestResult> {
  const db = getDb(d1);
  const timestamp = new Date().toISOString();
  const requestId = `dsr_${generateId(16)}`;
  const authSessionDelete = await db.delete(authSessions).where(
    eq(authSessions.accountId, user.id),
  ).run();
  const metadataValue = JSON.stringify({
    status: "pending",
    request_id: requestId,
    requested_at: timestamp,
    source: "self_service",
    reason: safeReason(options.reason),
    immediate_actions: [
      "auth_sessions_deleted",
      "account_login_disabled",
    ],
  });

  await upsertDeletionRequestMetadata(d1, user.id, metadataValue, timestamp);
  await db.update(accounts).set({
    status: "pending_deletion",
    updatedAt: timestamp,
  }).where(eq(accounts.id, user.id));

  return {
    request_id: requestId,
    status: "pending",
    requested_at: timestamp,
    account_status: "pending_deletion",
    revoked: {
      auth_sessions: affectedRowCount(authSessionDelete),
    },
  };
}
