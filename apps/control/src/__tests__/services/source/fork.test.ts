import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: () => "fork-id",
  now: () => "2026-03-24T00:00:00.000Z",
  forkRepository: ((..._args: any[]) => undefined) as any,
  checkSyncStatus: ((..._args: any[]) => undefined) as any,
  getBranch: ((..._args: any[]) => undefined) as any,
  updateBranch: ((..._args: any[]) => undefined) as any,
  getDefaultBranch: ((..._args: any[]) => undefined) as any,
  getCommitData: ((..._args: any[]) => undefined) as any,
  listDirectory: ((..._args: any[]) => undefined) as any,
  sanitizeRepoName: (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
import {
  forkWithWorkflows,
  getSyncStatus,
  syncWithUpstream,
} from "@/services/source/fork";

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    set: function (this: any) {
      return this;
    },
    values: function (this: any) {
      return this;
    },
    returning: function (this: any) {
      return this;
    },
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock },
  };
}

const sourceRepo = {
  id: "source-1",
  accountId: "ws-source",
  name: "original-repo",
  description: "desc",
  visibility: "public",
  defaultBranch: "main",
  forkedFromId: null,
  stars: 10,
  forks: 3,
  gitEnabled: true,
  isOfficial: false,
  officialCategory: null,
  officialMaintainer: null,
  featured: false,
  installCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

Deno.test("forkWithWorkflows - throws when source repo not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any;
  mocks.getDb = (() => drizzle) as any;

  await assertRejects(async () => {
    await forkWithWorkflows(
      {} as D1Database,
      undefined,
      "nonexistent",
      "ws-target",
    );
  }, "Source repository not found");
});
Deno.test("forkWithWorkflows - throws when name already exists in target workspace", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => sourceRepo) as any // source repo found
     =
      (async () => ({ id: "existing" })) as any; // name conflict
  mocks.getDb = (() => drizzle) as any;

  await assertRejects(async () => {
    await forkWithWorkflows(
      {} as D1Database,
      undefined,
      "source-1",
      "ws-target",
    );
  }, "Repository with this name already exists");
});
Deno.test("forkWithWorkflows - forks repo successfully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => sourceRepo) as any // source repo
     =
    (async () => undefined) as any // no name conflict
     =
      (async () => ({
        ...sourceRepo,
        id: "fork-id",
        accountId: "ws-target",
        forkedFromId: "source-1",
      })) as any; // forked repo
  mocks.getDb = (() => drizzle) as any;
  mocks.forkRepository = (async () => undefined) as any;

  const result = await forkWithWorkflows(
    {} as D1Database,
    undefined,
    "source-1",
    "ws-target",
  );

  assertEquals(result.repository.id, "fork-id");
  assertEquals(result.forked_from.id, "source-1");
  assert(mocks.forkRepository.calls.length > 0);
  assert(drizzle.update.calls.length > 0); // forks counter
});
Deno.test("forkWithWorkflows - respects custom fork name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => sourceRepo) as any =
    (async () => undefined) as any =
      (async () => ({ ...sourceRepo, id: "fork-id", name: "my-fork" })) as any;
  mocks.getDb = (() => drizzle) as any;
  mocks.forkRepository = (async () => undefined) as any;

  const result = await forkWithWorkflows(
    {} as D1Database,
    undefined,
    "source-1",
    "ws-target",
    { name: "My Fork" },
  );

  assert(result.repository !== undefined);
  assertSpyCallArgs(mocks.sanitizeRepoName, 0, ["My Fork"]);
});

Deno.test("getSyncStatus - returns no-sync when repo not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any;
  mocks.getDb = (() => drizzle) as any;

  await assertRejects(async () => {
    await getSyncStatus({} as D1Database, undefined, "repo-1");
  }, "Repository not found");
});
Deno.test("getSyncStatus - returns no-sync when repo is not a fork", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({ ...sourceRepo, forkedFromId: null })) as any;
  mocks.getDb = (() => drizzle) as any;

  const result = await getSyncStatus({} as D1Database, undefined, "repo-1");
  assertEquals(result.can_sync, false);
  assertEquals(result.upstream, null);
});
Deno.test("getSyncStatus - returns sync status for forked repo", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  const fork = { ...sourceRepo, id: "fork-1", forkedFromId: "source-1" };
  drizzle._.get =
    (async () => fork) as any // fork repo
     =
    (async () => sourceRepo) as any // upstream repo
     =
      (async () => ({ createdAt: "2026-01-01T00:00:00.000Z" })) as any; // fork created time
  drizzle._.all = (async () => []) as any; // releases
  mocks.getDb = (() => drizzle) as any;
  mocks.checkSyncStatus = (async () => ({
    can_sync: true,
    can_fast_forward: true,
    commits_behind: 3,
    commits_ahead: 0,
    has_conflict: false,
  })) as any;

  const result = await getSyncStatus(
    {} as D1Database,
    {} as R2Bucket,
    "fork-1",
  );
  assertEquals(result.can_sync, true);
  assertEquals(result.commits_behind, 3);
  assertNotEquals(result.upstream, null);
  assertEquals(result.upstream!.id, "source-1");
});

Deno.test("syncWithUpstream - throws when repo is not a fork", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({ ...sourceRepo, forkedFromId: null })) as any;
  mocks.getDb = (() => drizzle) as any;

  await assertRejects(async () => {
    await syncWithUpstream({} as D1Database, {} as R2Bucket, "repo-1");
  }, "Repository is not a fork");
});
Deno.test("syncWithUpstream - throws when git storage not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => ({
      ...sourceRepo,
      id: "fork-1",
      forkedFromId: "source-1",
    })) as any =
      (async () => sourceRepo) as any;
  mocks.getDb = (() => drizzle) as any;

  await assertRejects(async () => {
    await syncWithUpstream({} as D1Database, undefined, "fork-1");
  }, "Git storage not configured");
});
Deno.test("syncWithUpstream - returns conflict status when diverged", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => ({
      ...sourceRepo,
      id: "fork-1",
      forkedFromId: "source-1",
    })) as any =
      (async () => sourceRepo) as any;
  mocks.getDb = (() => drizzle) as any;
  mocks.checkSyncStatus = (async () => ({
    can_sync: true,
    can_fast_forward: false,
    commits_behind: 2,
    commits_ahead: 1,
    has_conflict: true,
  })) as any;

  const result = await syncWithUpstream(
    {} as D1Database,
    {} as R2Bucket,
    "fork-1",
  );
  assertEquals(result.success, false);
  assertEquals(result.conflict, true);
});
Deno.test("syncWithUpstream - returns already up to date when nothing to sync", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => ({
      ...sourceRepo,
      id: "fork-1",
      forkedFromId: "source-1",
    })) as any =
      (async () => sourceRepo) as any;
  mocks.getDb = (() => drizzle) as any;
  mocks.checkSyncStatus = (async () => ({
    can_sync: false,
    can_fast_forward: false,
    commits_behind: 0,
    commits_ahead: 0,
    has_conflict: false,
  })) as any;

  const result = await syncWithUpstream(
    {} as D1Database,
    {} as R2Bucket,
    "fork-1",
  );
  assertEquals(result.success, true);
  assertEquals(result.commits_synced, 0);
  assertEquals(result.message, "Already up to date");
});
