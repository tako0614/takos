import { test } from "bun:test";
import { assertEquals, assertExists } from "@takos/test/assert";

import type { Env } from "../../../../shared/types/index.ts";
import { spaceCrudDeps } from "../space-crud-shared.ts";
import {
  createWorkspaceWithDefaultRepo,
  spaceCrudWriteDeps,
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

test("createWorkspaceWithDefaultRepo enqueues featured app preinstall after space bootstrap", async () => {
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
    const result = await createWorkspaceWithDefaultRepo(
      { DB: db } as Env,
      "user-1",
      "Docs Team",
      { id: "space-1", skipIdCheck: true, installFeaturedApps: true },
    );

    assertEquals(result.workspace.id, "space-1");
    assertExists(result.repository);
    assertEquals(accountRows.length, 1);
    assertEquals(membershipRows.length, 1);
    assertEquals(repositoryRows.length, 1);
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

test("createWorkspaceWithDefaultRepo skips featured app preinstall when explicitly disabled", async () => {
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
    const result = await createWorkspaceWithDefaultRepo(
      { DB: db } as Env,
      "user-1",
      "Blank Team",
      {
        id: "space-blank",
        skipIdCheck: true,
        installFeaturedApps: false,
      },
    );

    assertEquals(result.workspace.id, "space-blank");
    assertExists(result.repository);
    assertEquals(accountRows.length, 1);
    assertEquals(membershipRows.length, 1);
    assertEquals(repositoryRows.length, 1);
    assertEquals(enqueueCalled, false);
    assertEquals(processCalled, false);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalResolveUserPrincipalId;
    spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = originalEnqueue;
    spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = originalProcess;
  }
});

test("createWorkspaceWithDefaultRepo still creates the space when featured app enqueue fails (idempotent compensation)", async () => {
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
    const result = await createWorkspaceWithDefaultRepo(
      { DB: db } as Env,
      "user-1",
      "Docs Team",
      { id: "space-1", skipIdCheck: true, installFeaturedApps: true },
    );

    assertEquals(result.workspace.id, "space-1");
    assertExists(result.repository);
    assertEquals(accountRows.length, 1);
    assertEquals(membershipRows.length, 1);
    assertEquals(repositoryRows.length, 1);
    // No preinstall job id was returned, so post-commit processing is skipped.
    assertEquals(processCalled, false);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalResolveUserPrincipalId;
    spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = originalEnqueue;
    spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = originalProcess;
  }
});

test("createWorkspaceWithDefaultRepo succeeds when immediate preinstall processing fails", async () => {
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
    const result = await createWorkspaceWithDefaultRepo(
      { DB: db } as Env,
      "user-1",
      "Docs Team",
      { id: "space-1", skipIdCheck: true, installFeaturedApps: true },
    );

    assertEquals(result.workspace.id, "space-1");
    assertExists(result.repository);
    assertEquals(accountRows.length, 1);
    assertEquals(membershipRows.length, 1);
    assertEquals(repositoryRows.length, 1);
  } finally {
    spaceCrudDeps.resolveUserPrincipalId = originalResolveUserPrincipalId;
    spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob = originalEnqueue;
    spaceCrudWriteDeps.processFeaturedAppPreinstallJobs = originalProcess;
  }
});
