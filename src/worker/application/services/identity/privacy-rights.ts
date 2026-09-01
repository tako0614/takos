import { and, desc, eq, inArray } from "drizzle-orm";

import type { User } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { generateId } from "../../../shared/utils/index.ts";
import type { Database } from "../../../infra/db/index.ts";
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
  runContextRevisions,
  runGrants,
  runs,
  threads,
  workspaceDeletionReceipts,
} from "../../../infra/db/index.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";

const DELETION_REQUEST_METADATA_KEY = "privacy.deletion_request";
const PRIVACY_RIGHTS_VERSION = "2026-05-07";
const PRIVACY_EXPORT_THREAD_BATCH_SIZE = 50;
const MAX_PRIVACY_METADATA_ROWS = 2_000;
const MAX_PRIVACY_COLLECTION_ROWS = 2_000;
const MAX_PRIVACY_USAGE_EVENT_ROWS = 5_000;
const MAX_PRIVACY_MESSAGE_ROWS = 5_000;
const MAX_PRIVACY_RUN_ROWS = 2_000;
export const MAX_PRIVACY_EXPORT_BYTES = 16 * 1024 * 1024;

export class PrivacyExportCapacityError extends Error {
  readonly code = "privacy_export_requires_assistance";

  constructor(readonly collection: string) {
    super(`Privacy export exceeds the synchronous ${collection} capacity`);
    this.name = "PrivacyExportCapacityError";
  }
}

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
  readonly run_authority: {
    readonly grants: unknown[];
    readonly context_revisions: unknown[];
  };
  readonly memories: unknown[];
  readonly notifications: unknown[];
  readonly workspace_deletions: unknown[];
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

type PrivacyDb = SqlDatabaseBinding | Database;

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

export function sanitizePrivacyAuthIdentities(
  rows: Array<{
    id: string;
    linkedAt: string;
    lastLoginAt: string;
  }>,
) {
  return rows.map((row) => ({
    id: row.id,
    linked_at: row.linkedAt,
    last_login_at: row.lastLoginAt,
  }));
}

async function readDeletionRequestMetadata(
  d1: PrivacyDb,
  accountId: string,
): Promise<Array<{ key: string; value: string }>> {
  const db = getDb(d1);
  const row = await db.select({
    key: accountMetadata.key,
    value: accountMetadata.value,
  }).from(accountMetadata).where(
    and(
      eq(accountMetadata.accountId, accountId),
      eq(accountMetadata.key, DELETION_REQUEST_METADATA_KEY),
    ),
  ).get();
  return row ? [row] : [];
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function readPrivacyMetadata(
  d1: PrivacyDb,
  accountId: string,
  maxRows = 100,
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
    .limit(maxRows + 1)
    .all();
  if (rows.length > maxRows) {
    throw new PrivacyExportCapacityError("metadata");
  }
  return rows;
}

function requireBoundedRows<T>(
  rows: T[],
  maxRows: number,
  collection: string,
): T[] {
  if (rows.length > maxRows) {
    throw new PrivacyExportCapacityError(collection);
  }
  return rows;
}

function assertPrivacyExportBytes(value: unknown): void {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new PrivacyExportCapacityError("serialization");
  }
  if (new TextEncoder().encode(json).byteLength > MAX_PRIVACY_EXPORT_BYTES) {
    throw new PrivacyExportCapacityError("payload");
  }
}

export async function getPrivacyAccessSummary(
  d1: PrivacyDb,
  user: User,
): Promise<PrivacyAccessSummary> {
  const deletionRequestMetadata = await readDeletionRequestMetadata(
    d1,
    user.id,
  );
  return {
    version: PRIVACY_RIGHTS_VERSION,
    subject: normalizeSubject(user),
    request_status: parseDeletionRequestStatus(deletionRequestMetadata),
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
  d1: PrivacyDb,
  user: User,
): Promise<DataSubjectExport> {
  const db = getDb(d1);
  const accountRows = await db.select().from(accounts).where(
    eq(accounts.id, user.id),
  ).limit(2).all();
  const metadata = await readPrivacyMetadata(
    d1,
    user.id,
    MAX_PRIVACY_METADATA_ROWS,
  );
  const settings = requireBoundedRows(
    await db.select().from(accountSettings).where(
      eq(accountSettings.accountId, user.id),
    ).limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "settings",
  );
  const memberships = requireBoundedRows(
    await db.select().from(accountMemberships).where(
      eq(accountMemberships.memberId, user.id),
    ).limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "memberships",
  );
  const identityRows = requireBoundedRows(
    await db.select({
      id: authIdentities.id,
      linkedAt: authIdentities.linkedAt,
      lastLoginAt: authIdentities.lastLoginAt,
    }).from(authIdentities).where(
      eq(authIdentities.userId, user.id),
    ).limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "auth.identities",
  );
  const sessionRows = requireBoundedRows(
    await db.select({
      id: authSessions.id,
      user_agent: authSessions.userAgent,
      ip_address: authSessions.ipAddress,
      expires_at: authSessions.expiresAt,
      created_at: authSessions.createdAt,
    }).from(authSessions).where(eq(authSessions.accountId, user.id))
      .limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "auth.sessions",
  );
  const appUsageEventRows = requireBoundedRows(
    await db.select().from(appUsageEvents).where(
      eq(appUsageEvents.ownerAccountId, user.id),
    ).orderBy(desc(appUsageEvents.createdAt))
      .limit(MAX_PRIVACY_USAGE_EVENT_ROWS + 1).all(),
    MAX_PRIVACY_USAGE_EVENT_ROWS,
    "app_usage.events",
  );
  const appUsageRollupRows = requireBoundedRows(
    await db.select().from(appUsageRollups).where(
      eq(appUsageRollups.ownerAccountId, user.id),
    ).orderBy(desc(appUsageRollups.updatedAt))
      .limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "app_usage.rollups",
  );
  const repositoryRows = requireBoundedRows(
    await db.select({
      id: repositories.id,
      account_id: repositories.accountId,
      name: repositories.name,
      description: repositories.description,
      visibility: repositories.visibility,
      default_branch: repositories.defaultBranch,
      forked_from_id: repositories.forkedFromId,
      stars: repositories.stars,
      forks: repositories.forks,
      git_enabled: repositories.gitEnabled,
      primary_language: repositories.primaryLanguage,
      license: repositories.license,
      featured: repositories.featured,
      install_count: repositories.installCount,
      created_at: repositories.createdAt,
      updated_at: repositories.updatedAt,
    }).from(repositories).where(
      eq(repositories.accountId, user.id),
    ).orderBy(desc(repositories.updatedAt))
      .limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "repositories",
  );
  const threadRows = requireBoundedRows(
    await db.select().from(threads).where(
      eq(threads.accountId, user.id),
    ).orderBy(desc(threads.updatedAt))
      .limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "threads",
  );
  const threadIds = threadRows.map((thread) => thread.id);
  const messageRows: Array<{
    id: string;
    thread_id: string;
    role: string;
    content: string;
    tool_calls: string | null;
    tool_call_id: string | null;
    metadata: string;
    sequence: number;
    created_at: string;
  }> = [];
  const runRows: Array<{
    id: string;
    thread_id: string;
    account_id: string;
    requester_account_id: string | null;
    session_id: string | null;
    parent_run_id: string | null;
    child_thread_id: string | null;
    root_thread_id: string | null;
    root_run_id: string | null;
    agent_type: string;
    model: string | null;
    status: string;
    last_event_id: number;
    input: string;
    output: string | null;
    error: string | null;
    usage: string;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  }> = [];
  for (const threadBatch of chunks(
    threadIds,
    PRIVACY_EXPORT_THREAD_BATCH_SIZE,
  )) {
    const remainingMessages = MAX_PRIVACY_MESSAGE_ROWS - messageRows.length;
    const messageBatch = await db.select({
      id: messages.id,
      thread_id: messages.threadId,
      role: messages.role,
      content: messages.content,
      tool_calls: messages.toolCalls,
      tool_call_id: messages.toolCallId,
      metadata: messages.metadata,
      sequence: messages.sequence,
      created_at: messages.createdAt,
    }).from(messages).where(
      inArray(messages.threadId, threadBatch),
    ).orderBy(messages.threadId, messages.sequence)
      .limit(remainingMessages + 1).all();
    if (messageBatch.length > remainingMessages) {
      throw new PrivacyExportCapacityError("messages");
    }
    messageRows.push(...messageBatch);
    const remainingRuns = MAX_PRIVACY_RUN_ROWS - runRows.length;
    const runBatch = await db.select({
      id: runs.id,
      thread_id: runs.threadId,
      account_id: runs.accountId,
      requester_account_id: runs.requesterAccountId,
      session_id: runs.sessionId,
      parent_run_id: runs.parentRunId,
      child_thread_id: runs.childThreadId,
      root_thread_id: runs.rootThreadId,
      root_run_id: runs.rootRunId,
      agent_type: runs.agentType,
      model: runs.model,
      status: runs.status,
      last_event_id: runs.lastEventId,
      input: runs.input,
      output: runs.output,
      error: runs.error,
      usage: runs.usage,
      started_at: runs.startedAt,
      completed_at: runs.completedAt,
      created_at: runs.createdAt,
    }).from(runs).where(inArray(runs.threadId, threadBatch))
      .orderBy(desc(runs.createdAt)).limit(remainingRuns + 1).all();
    if (runBatch.length > remainingRuns) {
      throw new PrivacyExportCapacityError("runs");
    }
    runRows.push(...runBatch);
  }
  messageRows.sort((left, right) =>
    left.thread_id.localeCompare(right.thread_id) ||
    left.sequence - right.sequence
  );
  runRows.sort((left, right) =>
    right.created_at.localeCompare(left.created_at)
  );
  const runGrantRows = requireBoundedRows(
    await db.select().from(runGrants).where(
      eq(runGrants.principalId, user.id),
    ).orderBy(desc(runGrants.createdAt))
      .limit(MAX_PRIVACY_RUN_ROWS + 1).all(),
    MAX_PRIVACY_RUN_ROWS,
    "run_authority.grants",
  );
  const runContextRevisionRows = requireBoundedRows(
    await db.select().from(runContextRevisions).where(
      eq(runContextRevisions.principalId, user.id),
    ).orderBy(desc(runContextRevisions.createdAt))
      .limit(MAX_PRIVACY_RUN_ROWS + 1).all(),
    MAX_PRIVACY_RUN_ROWS,
    "run_authority.context_revisions",
  );
  const memoryRows = requireBoundedRows(
    await db.select().from(memories).where(
      eq(memories.accountId, user.id),
    ).orderBy(desc(memories.updatedAt))
      .limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "memories",
  );
  const notificationRows = requireBoundedRows(
    await db.select().from(notifications).where(
      eq(notifications.recipientAccountId, user.id),
    ).orderBy(desc(notifications.createdAt))
      .limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "notifications",
  );
  const workspaceDeletionRows = requireBoundedRows(
    await db.select({
      operation_id: workspaceDeletionReceipts.operationId,
      workspace_id: workspaceDeletionReceipts.workspaceId,
      deleted_at: workspaceDeletionReceipts.deletedAt,
    }).from(workspaceDeletionReceipts).where(
      eq(workspaceDeletionReceipts.requestedByUserId, user.id),
    ).orderBy(desc(workspaceDeletionReceipts.deletedAt))
      .limit(MAX_PRIVACY_COLLECTION_ROWS + 1).all(),
    MAX_PRIVACY_COLLECTION_ROWS,
    "workspace_deletions",
  );

  const payload: DataSubjectExport = {
    ...(await getPrivacyAccessSummary(d1, user)),
    exported_at: new Date().toISOString(),
    account: accountRows[0] ?? null,
    settings,
    metadata,
    memberships,
    auth: {
      identities: sanitizePrivacyAuthIdentities(identityRows),
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
    run_authority: {
      grants: runGrantRows,
      context_revisions: runContextRevisionRows,
    },
    memories: memoryRows,
    notifications: notificationRows,
    workspace_deletions: workspaceDeletionRows,
  };
  assertPrivacyExportBytes(payload);
  return payload;
}

export async function requestAccountDeletion(
  d1: PrivacyDb,
  user: User,
  options: DeletionRequestOptions = {},
): Promise<DeletionRequestResult> {
  const db = getDb(d1);
  const timestamp = new Date().toISOString();
  const requestId = `dsr_${generateId(16)}`;
  const priorMetadata = await db.select({
    value: accountMetadata.value,
  }).from(accountMetadata).where(
    and(
      eq(accountMetadata.accountId, user.id),
      eq(accountMetadata.key, DELETION_REQUEST_METADATA_KEY),
    ),
  ).get();
  const priorRequestStatus = priorMetadata
    ? parseDeletionRequestStatus([{
      key: DELETION_REQUEST_METADATA_KEY,
      value: priorMetadata.value,
    }])
    : { status: "none" as const };
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
  const metadataInsert = db.insert(accountMetadata).values({
    accountId: user.id,
    key: DELETION_REQUEST_METADATA_KEY,
    value: metadataValue,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const metadataWrite = priorRequestStatus.status === "pending"
    ? db.insert(accountMetadata).values({
      accountId: user.id,
      key: DELETION_REQUEST_METADATA_KEY,
      value: priorMetadata!.value,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).onConflictDoNothing()
    : priorMetadata
      ? metadataInsert.onConflictDoUpdate({
        target: [accountMetadata.accountId, accountMetadata.key],
        set: { value: metadataValue, updatedAt: timestamp },
        where: eq(accountMetadata.value, priorMetadata.value),
      })
      : metadataInsert.onConflictDoNothing();
  const disableAccount = db.update(accounts).set({
    status: "pending_deletion",
    updatedAt: timestamp,
  }).where(eq(accounts.id, user.id));
  const deleteSessions = db.delete(authSessions).where(
    eq(authSessions.accountId, user.id),
  ).returning({ id: authSessions.id });

  // D1 executes a batch sequentially and atomically. An account-disable or
  // metadata failure therefore cannot leave sessions revoked without an
  // accepted request (or accept a request while login remains active).
  const [, , deletedSessions] = await db.batch([
    metadataWrite,
    disableAccount,
    deleteSessions,
  ]);
  const account = await db.select({ status: accounts.status }).from(accounts)
    .where(eq(accounts.id, user.id)).get();
  if (account?.status !== "pending_deletion") {
    throw new Error("Deletion request account transition failed");
  }
  const canonicalMetadata = await readDeletionRequestMetadata(d1, user.id);
  const canonicalStatus = parseDeletionRequestStatus(canonicalMetadata);
  if (
    canonicalStatus.status !== "pending" ||
    !canonicalStatus.request_id || !canonicalStatus.requested_at
  ) {
    throw new Error("Deletion request metadata transition failed");
  }

  return {
    request_id: canonicalStatus.request_id,
    status: "pending",
    requested_at: canonicalStatus.requested_at,
    account_status: "pending_deletion",
    revoked: {
      auth_sessions: Array.isArray(deletedSessions)
        ? deletedSessions.length
        : affectedRowCount(deletedSessions),
    },
  };
}
