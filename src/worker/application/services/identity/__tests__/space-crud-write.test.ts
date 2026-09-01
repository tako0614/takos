import { expect, test } from "bun:test";
import { assertEquals, assertExists, assertRejects } from "@takos/test/assert";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import {
  type Env,
  MAX_SPACE_DESCRIPTION_CHARACTERS,
  MAX_SPACE_NAME_CHARACTERS,
} from "../../../../shared/types/index.ts";
import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/index.ts";
import { spaceCrudDeps } from "../space-crud-shared.ts";
import {
  createWorkspace,
  deleteWorkspace,
  pruneWorkspaceDeletionReceipts,
  spaceCrudWriteDeps,
  updateWorkspace,
} from "../space-crud-write.ts";

function createWorkspaceDb() {
  const accountRows: Array<Record<string, unknown>> = [];
  const membershipRows: Array<Record<string, unknown>> = [];
  const repositoryRows: Array<Record<string, unknown>> = [];
  let selectGetCount = 0;

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            get: async () => {
              selectGetCount += 1;
              if (selectGetCount === 1) return undefined;
              if (selectGetCount === 2) return accountRows[0];
              if (selectGetCount === 3) return repositoryRows[0];
              return undefined;
            },
          }),
        }),
      }),
    }),
    insert: () => ({
      // Returns a thenable "statement" so it can be either awaited directly or
      // collected into batch([...]). Resolving applies the row to the in-memory
      // store, matching drizzle's lazy query-builder execution.
      values: (row: Record<string, unknown>) => {
        const apply = () => {
          if ("gitEnabled" in row) {
            repositoryRows.push(row);
          } else if ("memberId" in row) {
            membershipRows.push(row);
          } else {
            accountRows.push(row);
          }
        };
        return {
          then: (resolve: (v: unknown) => unknown) => {
            apply();
            return Promise.resolve(undefined).then(resolve);
          },
        };
      },
    }),
    // Atomic batch: execute each collected statement (createSpaceBundle relies
    // on drizzle.batch for the account+membership+repo group).
    batch: async (stmts: Array<PromiseLike<unknown>>) => {
      await Promise.all(stmts);
      return [];
    },
    update: () => ({
      set: () => ({
        where: () => ({
          run: async () => undefined,
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        run: async () => undefined,
      }),
    }),
  };

  return {
    db: db as unknown as Env["DB"],
    accountRows,
    membershipRows,
    repositoryRows,
  };
}

async function createWorkspaceDeletionDb() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      picture TEXT,
      bio TEXT,
      email TEXT,
      trust_tier TEXT NOT NULL DEFAULT 'new',
      setup_completed INTEGER NOT NULL DEFAULT 0,
      default_repository_id TEXT,
      head_snapshot_id TEXT,
      ai_model TEXT,
      model_backend TEXT,
      security_posture TEXT NOT NULL DEFAULT 'standard',
      owner_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE account_memberships (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(account_id, member_id)
    );
    CREATE TABLE workspace_deletion_receipts (
      operation_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE,
      requested_by_user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      request_signature TEXT NOT NULL,
      deleted_at TEXT NOT NULL
    );
    CREATE TABLE account_env_vars (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE agent_tasks (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE memories (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE memory_claims (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE memory_evidence (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE memory_claim_edges (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE memory_paths (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE reminders (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE skills (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE threads (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE account_storage_files (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE files (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE chunks (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE index_jobs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE info_units (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE mcp_oauth_pending (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE mcp_registry_sources (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE mcp_tool_confirmations (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE mcp_tool_policies (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE repositories (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE snapshots (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE blobs (hash TEXT NOT NULL, account_id TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE apps (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE services (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE bundle_deployments (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE deployments (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE groups (id TEXT PRIMARY KEY, space_id TEXT NOT NULL);
    CREATE TABLE resources (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      owner_account_id TEXT NOT NULL
    );
    CREATE TABLE edges (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE nodes (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE infra_endpoints (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE file_handlers (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE ui_extensions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE featured_app_preinstall_jobs (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL
    );
    CREATE TRIGGER workspace_delete_requires_empty
    BEFORE DELETE ON accounts
    WHEN OLD.type = 'team' AND (
      EXISTS (SELECT 1 FROM threads WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM runs WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM agent_tasks WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM memories WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM memory_claims WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM memory_evidence WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM memory_claim_edges WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM memory_paths WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM reminders WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM skills WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM account_storage_files WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM files WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM chunks WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM index_jobs WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM info_units WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM account_env_vars WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM mcp_oauth_pending WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM mcp_registry_sources WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM mcp_servers WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM mcp_tool_confirmations WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM mcp_tool_policies WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM repositories WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM snapshots WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM blobs WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM sessions WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM apps WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM services WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM bundle_deployments WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM deployments WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM groups WHERE space_id = OLD.id) OR
      EXISTS (
        SELECT 1 FROM resources
        WHERE account_id = OLD.id OR owner_account_id = OLD.id
      ) OR
      EXISTS (SELECT 1 FROM edges WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM nodes WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM infra_endpoints WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM file_handlers WHERE account_id = OLD.id) OR
      EXISTS (SELECT 1 FROM ui_extensions WHERE account_id = OLD.id) OR
      EXISTS (
        SELECT 1 FROM featured_app_preinstall_jobs WHERE space_id = OLD.id
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'workspace_not_empty');
    END;
    INSERT INTO accounts (
      id, type, name, slug, email, owner_account_id, created_at, updated_at
    ) VALUES (
      'user-1', 'user', 'User', 'user-1', 'user@example.com', 'user-1',
      '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
    );
    INSERT INTO accounts (
      id, type, name, slug, owner_account_id, created_at, updated_at
    ) VALUES (
      'space-1', 'team', 'Delete Team', 'delete-team', 'user-1',
      '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
    );
    INSERT INTO account_memberships (
      id, account_id, member_id, role, status, updated_at, created_at
    ) VALUES (
      'membership-1', 'space-1', 'user-1', 'owner', 'active',
      '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
    );
  `);
  return {
    client,
    db: drizzle(client, { schema }) as unknown as Database,
  };
}

test("createWorkspace rejects invalid names and descriptions before persistence", async () => {
  const { db, accountRows } = createWorkspaceDb();
  await assertRejects(() =>
    createWorkspace({ DB: db } as Env, "user-1", "   ", {
      id: "space-1",
      skipIdCheck: true,
    })
  );
  await assertRejects(() =>
    createWorkspace(
      { DB: db } as Env,
      "user-1",
      "x".repeat(MAX_SPACE_NAME_CHARACTERS + 1),
      { id: "space-1", skipIdCheck: true },
    )
  );
  await assertRejects(() =>
    createWorkspace({ DB: db } as Env, "user-1", "Category", {
      id: "space-1",
      skipIdCheck: true,
      description: "x".repeat(MAX_SPACE_DESCRIPTION_CHARACTERS + 1),
    })
  );
  assertEquals(accountRows.length, 0);
});

test("updateWorkspace normalizes, persists, and clears category descriptions", async () => {
  const { client, db } = await createWorkspaceDeletionDb();
  try {
    const updated = await updateWorkspace(db, "space-1", {
      description: "  Work and planning  ",
    });
    assertEquals(updated?.description, "Work and planning");

    const stored = await client.execute({
      sql: "SELECT description FROM accounts WHERE id = ?",
      args: ["space-1"],
    });
    assertEquals(stored.rows[0]?.description, "Work and planning");

    await assertRejects(() =>
      updateWorkspace(db, "space-1", {
        description: "x".repeat(MAX_SPACE_DESCRIPTION_CHARACTERS + 1),
      })
    );

    const cleared = await updateWorkspace(db, "space-1", {
      description: null,
    });
    assertEquals(cleared?.description, null);
  } finally {
    client.close();
  }
});

test("createWorkspace enqueues featured app preinstall without creating Git hosting state", async () => {
  const originalResolveUserPrincipalId = spaceCrudDeps.resolveUserPrincipalId;
  const originalEnqueue = spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob;
  const originalProcess = spaceCrudWriteDeps.processFeaturedAppPreinstallJobs;
  const { db, accountRows, membershipRows, repositoryRows } =
    createWorkspaceDb();
  const enqueueCalls: Array<{
    spaceId: string;
    createdByAccountId?: string;
    timestamp?: string;
  }> = [];
  const processCalls: Array<{ spaceId?: string; limit?: number }> = [];

  spaceCrudDeps.resolveUserPrincipalId = (() => "principal-1") as any;
  spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = (async (_env, params) => {
    enqueueCalls.push(params);
    return "featured-app-preinstall:space-1";
  }) as typeof spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob;
  spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = (async (
    _env,
    options,
  ) => {
    processCalls.push(options ?? {});
    return {
      scanned: 1,
      processed: 1,
      completed: 1,
      blocked: 0,
      paused: 0,
      requeued: 0,
      failed: 0,
    };
  }) as typeof spaceCrudWriteDeps.processFeaturedAppPreinstallJobs;

  try {
    const result = await createWorkspace(
      { DB: db } as Env,
      "user-1",
      "Docs Team",
      { id: "space-1", skipIdCheck: true, installFeaturedApps: true },
    );

    assertEquals(result.id, "space-1");
    assertEquals("repository" in result, false);
    assertEquals(accountRows.length, 1);
    assertEquals(membershipRows.length, 1);
    assertEquals(repositoryRows.length, 0);
    assertEquals(enqueueCalls.length, 1);
    assertEquals(enqueueCalls[0].spaceId, "space-1");
    assertEquals(enqueueCalls[0].createdByAccountId, "user-1");
    assertExists(enqueueCalls[0].timestamp);
    assertEquals(processCalls, [{ limit: 1, spaceId: "space-1" }]);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalResolveUserPrincipalId;
    spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = originalEnqueue;
    spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = originalProcess;
  }
});

test("createWorkspace skips featured app preinstall when explicitly disabled", async () => {
  const originalResolveUserPrincipalId = spaceCrudDeps.resolveUserPrincipalId;
  const originalEnqueue = spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob;
  const originalProcess = spaceCrudWriteDeps.processFeaturedAppPreinstallJobs;
  const { db, accountRows, membershipRows, repositoryRows } =
    createWorkspaceDb();
  let enqueueCalled = false;
  let processCalled = false;

  spaceCrudDeps.resolveUserPrincipalId = (() => "principal-1") as any;
  spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = (async () => {
    enqueueCalled = true;
    throw new Error("enqueue should not run");
  }) as typeof spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob;
  spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = (async () => {
    processCalled = true;
    throw new Error("processor should not run");
  }) as typeof spaceCrudWriteDeps.processFeaturedAppPreinstallJobs;

  try {
    const result = await createWorkspace(
      { DB: db } as Env,
      "user-1",
      "Blank Team",
      {
        id: "space-blank",
        skipIdCheck: true,
        installFeaturedApps: false,
      },
    );

    assertEquals(result.id, "space-blank");
    assertEquals(accountRows.length, 1);
    assertEquals(membershipRows.length, 1);
    assertEquals(repositoryRows.length, 0);
    assertEquals(enqueueCalled, false);
    assertEquals(processCalled, false);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalResolveUserPrincipalId;
    spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = originalEnqueue;
    spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = originalProcess;
  }
});

test("createWorkspace replays one exact operation and rejects request drift", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      picture TEXT,
      bio TEXT,
      email TEXT,
      trust_tier TEXT NOT NULL DEFAULT 'new',
      setup_completed INTEGER NOT NULL DEFAULT 0,
      default_repository_id TEXT,
      head_snapshot_id TEXT,
      ai_model TEXT,
      model_backend TEXT,
      security_posture TEXT NOT NULL DEFAULT 'standard',
      owner_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE account_memberships (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(account_id, member_id)
    );
    CREATE TABLE account_metadata (
      account_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, key)
    );
    INSERT INTO accounts (
      id, type, name, slug, email, owner_account_id, created_at, updated_at
    ) VALUES (
      'user-1', 'user', 'User', 'user-1', 'user@example.com', 'user-1',
      '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
    );
  `);
  const db = drizzle(client, { schema }) as unknown as Database;
  const originalPrincipal = spaceCrudDeps.resolveUserPrincipalId;
  spaceCrudDeps.resolveUserPrincipalId = (async () => "user-1") as never;
  const key = "ab".repeat(16);

  try {
    const first = await createWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "Retry Team",
      {
        description: "Exact request",
        installFeaturedApps: false,
        idempotencyKey: key,
      },
    );
    const replay = await createWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "Retry Team",
      {
        description: "Exact request",
        installFeaturedApps: false,
        idempotencyKey: key,
      },
    );
    expect(first.id).toBe(`workspace_request_${key}`);
    expect(replay.id).toBe(first.id);
    expect((await client.execute(
      "SELECT id FROM accounts WHERE type = 'team'",
    )).rows).toHaveLength(1);
    expect((await client.execute(
      "SELECT id FROM account_memberships WHERE account_id = ?",
      [first.id],
    )).rows).toHaveLength(1);
    await expect(createWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "Retry Team",
      {
        description: "Exact request",
        installFeaturedApps: true,
        idempotencyKey: key,
      },
    )).rejects.toThrow("operation key already belongs");

    const concurrentKey = "cd".repeat(16);
    const concurrentOptions = {
      description: "Concurrent request",
      installFeaturedApps: false,
      idempotencyKey: concurrentKey,
    } as const;
    const [left, right] = await Promise.all([
      createWorkspace(
        { DB: db } as unknown as Env,
        "user-1",
        "Concurrent Team",
        concurrentOptions,
      ),
      createWorkspace(
        { DB: db } as unknown as Env,
        "user-1",
        "Concurrent Team",
        concurrentOptions,
      ),
    ]);
    expect(right.id).toBe(left.id);
    expect((await client.execute(
      "SELECT id FROM accounts WHERE type = 'team'",
    )).rows).toHaveLength(2);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalPrincipal;
    client.close();
  }
});

test("deleteWorkspace atomically deletes an empty team and replays its receipt", async () => {
  const { client, db } = await createWorkspaceDeletionDb();
  const originalPrincipal = spaceCrudDeps.resolveUserPrincipalId;
  const originalConfig = spaceCrudWriteDeps.resolveInstallableAppAccountsConfig;
  const originalList = spaceCrudWriteDeps.listInstallableAppCapsules;
  spaceCrudDeps.resolveUserPrincipalId = (async () => "user-1") as never;
  spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = (() => ({
    baseUrl: "https://accounts.example.test/",
  })) as typeof originalConfig;
  spaceCrudWriteDeps.listInstallableAppCapsules = (async () => ({
    status: 200,
    body: { capsules: [] },
  })) as typeof originalList;
  const operationId = "ef".repeat(16);

  try {
    const [first, concurrent] = await Promise.all([
      deleteWorkspace(
        { DB: db } as unknown as Env,
        "user-1",
        "space-1",
        { workspaceName: "Delete Team", idempotencyKey: operationId },
      ),
      deleteWorkspace(
        { DB: db } as unknown as Env,
        "user-1",
        "space-1",
        { workspaceName: "Delete Team", idempotencyKey: operationId },
      ),
    ]);
    const replay = await deleteWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "space-1",
      { workspaceName: "Delete Team", idempotencyKey: operationId },
    );
    expect(concurrent).toEqual(first);
    expect(replay).toEqual(first);
    expect(first.operation_id).toBe(operationId);
    expect((await client.execute(
      "SELECT id FROM accounts WHERE id = 'space-1'",
    )).rows).toHaveLength(0);
    expect((await client.execute(
      "SELECT id FROM account_memberships WHERE account_id = 'space-1'",
    )).rows).toHaveLength(0);
    expect((await client.execute(
      "SELECT operation_id FROM workspace_deletion_receipts",
    )).rows).toHaveLength(1);
    const receipt = await client.execute(
      "SELECT request_signature FROM workspace_deletion_receipts",
    );
    expect(String(receipt.rows[0]?.request_signature)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(receipt.rows[0]?.request_signature)).not.toContain(
      "Delete Team",
    );
    await expect(deleteWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "space-1",
      { workspaceName: "Changed", idempotencyKey: operationId },
    )).rejects.toThrow("operation key belongs to another request");
    await client.execute(
      "UPDATE workspace_deletion_receipts SET deleted_at = '2026-01-01T00:00:00.000Z'",
    );
    expect(await pruneWorkspaceDeletionReceipts(
      db as unknown as Env["DB"],
      { maxAgeMs: 30 * 24 * 60 * 60 * 1000, limit: 100 },
      Date.parse("2026-08-10T00:00:00.000Z"),
    )).toEqual({
      cutoff: "2026-07-11T00:00:00.000Z",
      selected: 1,
      deleted: 1,
      hasMore: false,
    });
    expect((await client.execute(
      "SELECT operation_id FROM workspace_deletion_receipts",
    )).rows).toHaveLength(0);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalPrincipal;
    spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = originalConfig;
    spaceCrudWriteDeps.listInstallableAppCapsules = originalList;
    client.close();
  }
});

test("deleteWorkspace deletes standalone local state without a remote Capsule ledger", async () => {
  const { client, db } = await createWorkspaceDeletionDb();
  const originalPrincipal = spaceCrudDeps.resolveUserPrincipalId;
  const originalConfig = spaceCrudWriteDeps.resolveInstallableAppAccountsConfig;
  spaceCrudDeps.resolveUserPrincipalId = (async () => "user-1") as never;
  spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = () => null;

  try {
    const result = await deleteWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "space-1",
      { workspaceName: "Delete Team", idempotencyKey: "a1".repeat(16) },
    );
    expect(result.operation_id).toBe("a1".repeat(16));
    expect((await client.execute(
      "SELECT id FROM accounts WHERE id = 'space-1'",
    )).rows).toHaveLength(0);
    expect((await client.execute(
      "SELECT operation_id FROM workspace_deletion_receipts",
    )).rows).toHaveLength(1);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalPrincipal;
    spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = originalConfig;
    client.close();
  }
});

test("deleteWorkspace refuses object-backed Workspace data without mutation", async () => {
  const { client, db } = await createWorkspaceDeletionDb();
  const originalPrincipal = spaceCrudDeps.resolveUserPrincipalId;
  const originalConfig = spaceCrudWriteDeps.resolveInstallableAppAccountsConfig;
  spaceCrudDeps.resolveUserPrincipalId = (async () => "user-1") as never;
  spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = () => null;
  await client.execute(
    "INSERT INTO threads (id, account_id) VALUES ('thread-1', 'space-1')",
  );

  try {
    await expect(deleteWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "space-1",
      { workspaceName: "Delete Team", idempotencyKey: "12".repeat(16) },
    )).rejects.toThrow("Chats and Runs");
    expect((await client.execute(
      "SELECT id FROM accounts WHERE id = 'space-1'",
    )).rows).toHaveLength(1);
    expect((await client.execute(
      "SELECT operation_id FROM workspace_deletion_receipts",
    )).rows).toHaveLength(0);
    await expect(client.execute(
      "DELETE FROM accounts WHERE id = 'space-1'",
    )).rejects.toThrow("workspace_not_empty");
    expect((await client.execute(
      "SELECT id FROM accounts WHERE id = 'space-1'",
    )).rows).toHaveLength(1);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalPrincipal;
    spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = originalConfig;
    client.close();
  }
});

test("deleteWorkspace refuses derived vector and non-FK Memory state", async () => {
  const { client, db } = await createWorkspaceDeletionDb();
  const originalPrincipal = spaceCrudDeps.resolveUserPrincipalId;
  const originalConfig = spaceCrudWriteDeps.resolveInstallableAppAccountsConfig;
  spaceCrudDeps.resolveUserPrincipalId = (async () => "user-1") as never;
  spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = () => null;

  try {
    await client.execute(
      "INSERT INTO info_units (id, account_id) VALUES ('info-1', 'space-1')",
    );
    await expect(deleteWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "space-1",
      { workspaceName: "Delete Team", idempotencyKey: "b1".repeat(16) },
    )).rejects.toThrow("source files or search indexes");
    await expect(client.execute(
      "DELETE FROM accounts WHERE id = 'space-1'",
    )).rejects.toThrow("workspace_not_empty");

    await client.execute("DELETE FROM info_units WHERE id = 'info-1'");
    await client.execute(
      "INSERT INTO memory_claims (id, account_id) VALUES ('claim-1', 'space-1')",
    );
    await expect(deleteWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "space-1",
      { workspaceName: "Delete Team", idempotencyKey: "b2".repeat(16) },
    )).rejects.toThrow("Agent tasks, Memories, Reminders, or Skills");
    await expect(client.execute(
      "DELETE FROM accounts WHERE id = 'space-1'",
    )).rejects.toThrow("workspace_not_empty");
    expect((await client.execute(
      "SELECT id FROM accounts WHERE id = 'space-1'",
    )).rows).toHaveLength(1);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalPrincipal;
    spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = originalConfig;
    client.close();
  }
});

test("deleteWorkspace refuses canonical Capsules and invalid name confirmation", async () => {
  const { client, db } = await createWorkspaceDeletionDb();
  const originalPrincipal = spaceCrudDeps.resolveUserPrincipalId;
  const originalConfig = spaceCrudWriteDeps.resolveInstallableAppAccountsConfig;
  const originalList = spaceCrudWriteDeps.listInstallableAppCapsules;
  spaceCrudDeps.resolveUserPrincipalId = (async () => "user-1") as never;
  spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = (() => ({
    baseUrl: "https://accounts.example.test/",
  })) as typeof originalConfig;
  spaceCrudWriteDeps.listInstallableAppCapsules = (async () => ({
    status: 200,
    body: { capsules: [{ capsule_id: "capsule-1" }] },
  })) as typeof originalList;

  try {
    await expect(deleteWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "space-1",
      { workspaceName: "Wrong", idempotencyKey: "34".repeat(16) },
    )).rejects.toThrow("name confirmation does not match");
    await expect(deleteWorkspace(
      { DB: db } as unknown as Env,
      "user-1",
      "space-1",
      { workspaceName: "Delete Team", idempotencyKey: "56".repeat(16) },
    )).rejects.toThrow("Capsules uninstalled");
    expect((await client.execute(
      "SELECT id FROM accounts WHERE id = 'space-1'",
    )).rows).toHaveLength(1);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalPrincipal;
    spaceCrudWriteDeps.resolveInstallableAppAccountsConfig = originalConfig;
    spaceCrudWriteDeps.listInstallableAppCapsules = originalList;
    client.close();
  }
});

test("createWorkspace still creates the space when featured app enqueue fails (idempotent compensation)", async () => {
  // The space bundle is committed atomically via drizzle.batch before the
  // preinstall job is enqueued. The enqueue is deterministic-id +
  // onConflictDoNothing, so a transient enqueue failure is recoverable on a
  // later access; it must NOT tear down a valid, already-committed space.
  const originalResolveUserPrincipalId = spaceCrudDeps.resolveUserPrincipalId;
  const originalEnqueue = spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob;
  const originalProcess = spaceCrudWriteDeps.processFeaturedAppPreinstallJobs;
  const { db, accountRows, membershipRows, repositoryRows } =
    createWorkspaceDb();
  let processCalled = false;

  spaceCrudDeps.resolveUserPrincipalId = (() => "principal-1") as any;
  spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = (async () => {
    throw new Error("featured app job table unavailable");
  }) as typeof spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob;
  spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = (async () => {
    processCalled = true;
    throw new Error("processor should not run when enqueue fails");
  }) as typeof spaceCrudWriteDeps.processFeaturedAppPreinstallJobs;

  try {
    const result = await createWorkspace(
      { DB: db } as Env,
      "user-1",
      "Docs Team",
      { id: "space-1", skipIdCheck: true, installFeaturedApps: true },
    );

    assertEquals(result.id, "space-1");
    assertEquals(accountRows.length, 1);
    assertEquals(membershipRows.length, 1);
    assertEquals(repositoryRows.length, 0);
    // No preinstall job id was returned, so post-commit processing is skipped.
    assertEquals(processCalled, false);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalResolveUserPrincipalId;
    spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = originalEnqueue;
    spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = originalProcess;
  }
});

test("createWorkspace succeeds when immediate preinstall processing fails", async () => {
  const originalResolveUserPrincipalId = spaceCrudDeps.resolveUserPrincipalId;
  const originalEnqueue = spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob;
  const originalProcess = spaceCrudWriteDeps.processFeaturedAppPreinstallJobs;
  const { db, accountRows, membershipRows, repositoryRows } =
    createWorkspaceDb();

  spaceCrudDeps.resolveUserPrincipalId = (() => "principal-1") as any;
  spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob =
    (async () =>
      "featured-app-preinstall:space-1") as typeof spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob;
  spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = (async () => {
    throw new Error("queue temporarily unavailable");
  }) as typeof spaceCrudWriteDeps.processFeaturedAppPreinstallJobs;

  try {
    const result = await createWorkspace(
      { DB: db } as Env,
      "user-1",
      "Docs Team",
      { id: "space-1", skipIdCheck: true, installFeaturedApps: true },
    );

    assertEquals(result.id, "space-1");
    assertEquals(accountRows.length, 1);
    assertEquals(membershipRows.length, 1);
    assertEquals(repositoryRows.length, 0);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalResolveUserPrincipalId;
    spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = originalEnqueue;
    spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = originalProcess;
  }
});
