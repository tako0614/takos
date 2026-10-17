import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { User } from "../../../../shared/types/index.ts";
import {
  accountMemberships,
  accounts,
  accountSettings,
  authIdentities,
  authSessions,
  getDb,
  memories,
  messages,
  notifications,
  repositories,
  runs,
  sessionsRevoked,
  threads,
} from "../../../../infra/db/index.ts";
import { openSqliteSqlDatabase } from "../../../../local-platform/persistent-d1.ts";
import type { ServerSqlDatabase } from "../../../../local-platform/persistent-d1.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { EMBEDDED_MIGRATIONS } from "../../../../platform/migrations/migration-set.ts";
import { runPendingMigrations } from "../../../../platform/migrations/runtime-migrations.ts";
import { buildDataSubjectExport } from "../privacy-rights.ts";

let directory: string;
let database: ServerSqlDatabase;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "takos-privacy-rights-"));
  database = await openSqliteSqlDatabase(join(directory, "privacy.sqlite"));
  const migrationStatus = await runPendingMigrations(database, {
    migrations: EMBEDDED_MIGRATIONS,
  });
  expect(migrationStatus.state).toBe("ready");
  expect(migrationStatus.applied).toBe(EMBEDDED_MIGRATIONS.length);
});

afterEach(async () => {
  database.close();
  await rm(directory, { force: true, recursive: true });
});

function makeUser(id: string): User {
  return {
    id,
    email: `${id}@example.test`,
    name: `User ${id}`,
    username: id,
    bio: null,
    picture: null,
    trust_tier: "new",
    setup_completed: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

async function insertAccount(user: User): Promise<void> {
  await getDb(database).insert(accounts).values({
    id: user.id,
    type: "user",
    name: user.name,
    slug: user.username,
    email: user.email,
    trustTier: user.trust_tier,
    setupCompleted: user.setup_completed,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  });
}

async function insertWorkspaceAccount(
  id: string,
  ownerAccountId: string,
  status = "active",
  updatedAt = "2026-01-01T00:00:00.000Z",
): Promise<void> {
  await getDb(database).insert(accounts).values({
    id,
    type: "team",
    status,
    name: id,
    slug: id,
    ownerAccountId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  });
}

function ids(rows: readonly unknown[]): string[] {
  return rows.map((row) => (row as { id: string }).id).sort();
}

function orderedIds(rows: readonly unknown[]): string[] {
  return rows.map((row) => (row as { id: string }).id);
}

function accountIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) throw new Error("expected settings array");
  return rows.map((row) => (row as { accountId: string }).accountId).sort();
}

function captureBindCounts(database: ServerSqlDatabase): {
  readonly binding: SqlDatabaseBinding;
  readonly statements: Array<{ readonly query: string; readonly count: number }>;
} {
  const statements: Array<{ query: string; count: number }> = [];
  const binding = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          const statement = target.prepare(query);
          return new Proxy(statement, {
            get(prepared, preparedProperty) {
              if (preparedProperty === "bind") {
                return (...values: unknown[]) => {
                  statements.push({ query, count: values.length });
                  return statement.bind(...values);
                };
              }
              const member = Reflect.get(prepared, preparedProperty, prepared);
              return typeof member === "function"
                ? member.bind(prepared)
                : member;
            },
          });
        };
      }
      const member = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  return { binding, statements };
}

async function snapshotWorkspaceExportTables() {
  const db = getDb(database);
  return Promise.all([
    db.select().from(accounts).all(),
    db.select().from(accountMemberships).all(),
    db.select().from(accountSettings).all(),
    db.select().from(notifications).all(),
    db.select().from(repositories).all(),
    db.select().from(threads).all(),
    db.select().from(messages).all(),
    db.select().from(runs).all(),
    db.select().from(memories).all(),
  ]);
}

describe("buildDataSubjectExport", () => {
  test("exports app-local auth metadata and owned revocations without secrets or cross-subject rows", async () => {
    const owner = makeUser("privacy-owner");
    const other = makeUser("privacy-other");
    await insertAccount(owner);
    await insertAccount(other);

    await getDb(database).insert(authIdentities).values({
      id: "owner-identity-link-id",
      userId: owner.id,
      provider: "takosumi-accounts",
      providerSub: "provider-subject-secret-sentinel",
      emailSnapshot: owner.email,
      emailKind: "verified",
      linkedAt: "2026-01-02T00:00:00.000Z",
      lastLoginAt: "2026-01-03T00:00:00.000Z",
      refreshTokenEnc: "refresh-ciphertext-secret-sentinel",
      accessTokenEnc: "access-ciphertext-secret-sentinel",
    });
    await getDb(database).insert(authSessions).values({
      id: "owner-app-local-session-mirror-id",
      accountId: owner.id,
      tokenHash: "session-token-hash-secret-sentinel",
      userAgent: "Takos test client",
      ipAddress: "192.0.2.10",
      expiresAt: "2026-02-01T00:00:00.000Z",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    await getDb(database).insert(sessionsRevoked).values([
      {
        sessionId: "owner-revoked-session-id-secret-sentinel",
        userId: owner.id,
        revokedAt: "2026-01-04T00:00:00.000Z",
        reason: "logout",
        expiresAt: "2026-02-01T00:00:00.000Z",
      },
      {
        sessionId: "other-revoked-session-id-secret-sentinel",
        userId: other.id,
        revokedAt: "2026-01-05T00:00:00.000Z",
        reason: "rotation",
        expiresAt: "2026-02-02T00:00:00.000Z",
      },
      {
        sessionId: "orphan-revoked-session-id-secret-sentinel",
        userId: null,
        revokedAt: "2026-01-06T00:00:00.000Z",
        reason: "logout",
        expiresAt: null,
      },
    ]);

    const before = await Promise.all([
      getDb(database).select().from(authIdentities).all(),
      getDb(database).select().from(authSessions).all(),
      getDb(database).select().from(sessionsRevoked).all(),
    ]);
    const exported = await buildDataSubjectExport(database, owner);
    const after = await Promise.all([
      getDb(database).select().from(authIdentities).all(),
      getDb(database).select().from(authSessions).all(),
      getDb(database).select().from(sessionsRevoked).all(),
    ]);
    const serialized = JSON.stringify(exported);

    expect(exported.auth.identities).toEqual([{
      id: "owner-identity-link-id",
      provider: "takosumi-accounts",
      email_snapshot: owner.email,
      email_kind: "verified",
      linked_at: "2026-01-02T00:00:00.000Z",
      last_login_at: "2026-01-03T00:00:00.000Z",
    }]);
    expect(exported.auth.sessions).toEqual([{
      id: "owner-app-local-session-mirror-id",
      user_agent: "Takos test client",
      ip_address: "192.0.2.10",
      expires_at: "2026-02-01T00:00:00.000Z",
      created_at: "2026-01-02T00:00:00.000Z",
    }]);
    expect(exported.auth.revocations).toEqual([{
      revoked_at: "2026-01-04T00:00:00.000Z",
      reason: "logout",
      expires_at: "2026-02-01T00:00:00.000Z",
    }]);
    for (const secret of [
      "provider-subject-secret-sentinel",
      "refresh-ciphertext-secret-sentinel",
      "access-ciphertext-secret-sentinel",
      "session-token-hash-secret-sentinel",
      "owner-revoked-session-id-secret-sentinel",
      "other-revoked-session-id-secret-sentinel",
      "orphan-revoked-session-id-secret-sentinel",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("other-revoked-session");
    expect(serialized).not.toContain("orphan-revoked-session");
    expect(after).toEqual(before);
  });

  test("exports content from the default and every authorized private Workspace only", async () => {
    const owner = makeUser("workspace-export-owner");
    const otherOwner = makeUser("workspace-export-other-owner");
    await insertAccount(owner);
    await insertAccount(otherOwner);

    const workspaceRows = [
      { id: "workspace-valid-a", owner: owner.id, updatedAt: "2026-03-01T00:00:00.000Z" },
      { id: "workspace-valid-b", owner: owner.id, updatedAt: "2026-02-01T00:00:00.000Z" },
      { id: "workspace-viewer", owner: otherOwner.id },
      { id: "workspace-forged-witness", owner: otherOwner.id },
      { id: "workspace-no-witness", owner: owner.id },
      { id: "workspace-inactive-witness", owner: owner.id },
      { id: "workspace-suspended", owner: owner.id, status: "suspended" },
    ];
    for (const workspace of workspaceRows) {
      await insertWorkspaceAccount(
        workspace.id,
        workspace.owner,
        workspace.status,
        workspace.updatedAt,
      );
    }

    const witnesses = [
      { id: "other-default-witness", accountId: otherOwner.id, memberId: otherOwner.id, role: "owner", status: "active" },
      { id: "valid-workspace-a-witness", accountId: "workspace-valid-a", memberId: owner.id, role: "owner", status: "active" },
      { id: "valid-workspace-b-witness", accountId: "workspace-valid-b", memberId: owner.id, role: "owner", status: "active" },
      { id: "viewer-workspace-owner-witness", accountId: "workspace-viewer", memberId: otherOwner.id, role: "owner", status: "active" },
      { id: "viewer-workspace-viewer", accountId: "workspace-viewer", memberId: owner.id, role: "viewer", status: "active" },
      { id: "forged-workspace-real-owner", accountId: "workspace-forged-witness", memberId: otherOwner.id, role: "owner", status: "active" },
      { id: "forged-workspace-owner-witness", accountId: "workspace-forged-witness", memberId: owner.id, role: "owner", status: "active" },
      { id: "inactive-workspace-witness", accountId: "workspace-inactive-witness", memberId: owner.id, role: "owner", status: "inactive" },
      { id: "suspended-workspace-witness", accountId: "workspace-suspended", memberId: owner.id, role: "owner", status: "active" },
    ];
    await getDb(database).insert(accountMemberships).values(witnesses);

    await getDb(database).insert(accountSettings).values([
      { accountId: owner.id },
      { accountId: "workspace-valid-a" },
      { accountId: "workspace-valid-b" },
      { accountId: otherOwner.id },
    ]);
    await getDb(database).insert(notifications).values([
      { id: "owner-notification", recipientAccountId: owner.id, type: "test", title: "Owner notification" },
      { id: "workspace-notification", recipientAccountId: "workspace-valid-a", type: "test", title: "Workspace notification" },
      { id: "other-notification", recipientAccountId: otherOwner.id, type: "test", title: "Other profile notification" },
    ]);

    const workspaceSeeds: Array<{
      workspaceId: string;
      prefix: string;
      threadId?: string;
      dataAt?: string;
      participantId?: string;
    }> = [
      { workspaceId: owner.id, prefix: "default-owner", threadId: "thread-00-default-owner", dataAt: "2026-01-01T00:00:00.000Z", participantId: otherOwner.id },
      { workspaceId: "workspace-valid-a", prefix: "valid-workspace-a", threadId: "thread-02-valid-a", dataAt: "2026-01-02T00:00:00.000Z" },
      { workspaceId: "workspace-valid-b", prefix: "valid-workspace-b", threadId: "thread-01-valid-b", dataAt: "2026-01-03T00:00:00.000Z" },
      { workspaceId: "workspace-viewer", prefix: "viewer-workspace" },
      { workspaceId: "workspace-forged-witness", prefix: "forged-workspace" },
      { workspaceId: "workspace-no-witness", prefix: "no-witness-workspace" },
      { workspaceId: "workspace-inactive-witness", prefix: "inactive-witness-workspace" },
      { workspaceId: "workspace-suspended", prefix: "suspended-workspace" },
      { workspaceId: otherOwner.id, prefix: "other-user-profile" },
    ];
    const repositoryRows: Array<typeof repositories.$inferInsert> = [];
    const threadRows: Array<typeof threads.$inferInsert> = [];
    const messageRows: Array<typeof messages.$inferInsert> = [];
    const runRows: Array<typeof runs.$inferInsert> = [];
    const memoryRows: Array<typeof memories.$inferInsert> = [];

    for (const { workspaceId, prefix, threadId = `${prefix}-thread`, dataAt = "2026-01-01T00:00:00.000Z", participantId } of workspaceSeeds) {
      repositoryRows.push({
        id: `${prefix}-repository`,
        accountId: workspaceId,
        name: `${prefix}-repository`,
        createdAt: dataAt,
        updatedAt: dataAt,
      });
      threadRows.push({ id: threadId, accountId: workspaceId, title: prefix, createdAt: dataAt, updatedAt: dataAt });
      messageRows.push({
        id: `${prefix}-message`,
        threadId,
        role: "user",
        content: participantId
          ? "external-participant-message-sentinel"
          : `${prefix}-message-content`,
        metadata: JSON.stringify({ participant_account_id: participantId ?? null }),
        createdAt: dataAt,
      });
      runRows.push({
        id: `${prefix}-run`,
        threadId,
        accountId: workspaceId,
        requesterAccountId: owner.id,
        createdAt: dataAt,
      });
      memoryRows.push({
        id: `${prefix}-memory`,
        accountId: workspaceId,
        authorAccountId: owner.id,
        threadId,
        type: "fact",
        content: `${prefix}-memory-content`,
        createdAt: dataAt,
        updatedAt: dataAt,
      });
    }
    for (const [index, dataAt] of [
      "2025-12-31T00:00:00.000Z",
      "2025-12-30T00:00:00.000Z",
    ].entries()) {
      const threadId = `thread-00-default-owner-extra-${index + 1}`;
      threadRows.push({
        id: threadId,
        accountId: owner.id,
        title: threadId,
        createdAt: dataAt,
        updatedAt: dataAt,
      });
      messageRows.push({
        id: `default-owner-extra-${index + 1}-message`,
        threadId,
        role: "assistant",
        content: `default-owner-extra-${index + 1}-message-content`,
        createdAt: dataAt,
      });
      runRows.push({
        id: `default-owner-extra-${index + 1}-run`,
        threadId,
        accountId: owner.id,
        requesterAccountId: owner.id,
        createdAt: dataAt,
      });
    }
    await getDb(database).insert(repositories).values(repositoryRows);
    await getDb(database).insert(threads).values(threadRows);
    await getDb(database).insert(messages).values(messageRows);
    await getDb(database).insert(runs).values(runRows);
    await getDb(database).insert(memories).values(memoryRows);
    await getDb(database).insert(runs).values({
      id: "run-account-thread-mismatch",
      threadId: "thread-00-default-owner",
      accountId: otherOwner.id,
      requesterAccountId: owner.id,
    });

    const before = await snapshotWorkspaceExportTables();
    const observedSql = captureBindCounts(database);
    const exported = await buildDataSubjectExport(observedSql.binding, owner);
    const after = await snapshotWorkspaceExportTables();

    expect(orderedIds(exported.repositories)).toEqual([
      "valid-workspace-b-repository",
      "valid-workspace-a-repository",
      "default-owner-repository",
    ]);
    expect(orderedIds(exported.threads)).toEqual([
      "thread-01-valid-b",
      "thread-02-valid-a",
      "thread-00-default-owner",
      "thread-00-default-owner-extra-1",
      "thread-00-default-owner-extra-2",
    ]);
    expect(orderedIds(exported.messages)).toEqual([
      "default-owner-message",
      "default-owner-extra-1-message",
      "default-owner-extra-2-message",
      "valid-workspace-b-message",
      "valid-workspace-a-message",
    ]);
    expect(orderedIds(exported.runs)).toEqual([
      "valid-workspace-b-run",
      "valid-workspace-a-run",
      "default-owner-run",
      "default-owner-extra-1-run",
      "default-owner-extra-2-run",
    ]);
    expect(orderedIds(exported.memories)).toEqual([
      "valid-workspace-b-memory",
      "valid-workspace-a-memory",
      "default-owner-memory",
    ]);
    expect(orderedIds(exported.workspaces)).toEqual([
      "workspace-valid-a",
      "workspace-valid-b",
    ]);
    const messageBindCounts = observedSql.statements
      .filter(({ query }) => query.toLowerCase().includes('from "messages"'))
      .map(({ count }) => count);
    const runBindCounts = observedSql.statements
      .filter(({ query }) => query.toLowerCase().includes('from "runs"'))
      .map(({ count }) => count);
    expect(messageBindCounts).toEqual([1, 1, 1]);
    expect(runBindCounts).toEqual([2, 2, 2]);
    expect(JSON.stringify(exported.messages)).toContain(
      "external-participant-message-sentinel",
    );
    expect(exported.account).toMatchObject({ id: owner.id });
    expect(accountIds(exported.settings)).toEqual([owner.id]);
    expect(ids(exported.notifications)).toEqual(["owner-notification"]);
    expect(after).toEqual(before);

    await getDb(database).insert(accountMemberships).values({
      id: "owner-default-witness",
      accountId: owner.id,
      memberId: owner.id,
      role: "owner",
      status: "active",
    });
    const withDefaultWitnessBefore = await snapshotWorkspaceExportTables();
    const withDefaultWitnessSql = captureBindCounts(database);
    const withDefaultWitnessExport = await buildDataSubjectExport(
      withDefaultWitnessSql.binding,
      owner,
    );
    const withDefaultWitnessAfter = await snapshotWorkspaceExportTables();

    expect(orderedIds(withDefaultWitnessExport.repositories)).toEqual(
      orderedIds(exported.repositories),
    );
    expect(orderedIds(withDefaultWitnessExport.threads)).toEqual(
      orderedIds(exported.threads),
    );
    expect(orderedIds(withDefaultWitnessExport.messages)).toEqual(
      orderedIds(exported.messages),
    );
    expect(orderedIds(withDefaultWitnessExport.runs)).toEqual(
      orderedIds(exported.runs),
    );
    expect(orderedIds(withDefaultWitnessExport.memories)).toEqual(
      orderedIds(exported.memories),
    );
    expect(orderedIds(withDefaultWitnessExport.workspaces)).toEqual([
      "workspace-valid-a",
      "workspace-valid-b",
      owner.id,
    ]);
    expect(withDefaultWitnessSql.statements.filter(({ query }) =>
      query.toLowerCase().includes('from "messages"')
    ).map(({ count }) => count)).toEqual([1, 1, 1]);
    expect(withDefaultWitnessSql.statements.filter(({ query }) =>
      query.toLowerCase().includes('from "runs"')
    ).map(({ count }) => count)).toEqual([2, 2, 2]);
    expect(withDefaultWitnessAfter).toEqual(withDefaultWitnessBefore);
  });
});
