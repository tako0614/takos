// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await no-unused-vars
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert";

import {
  forkWithWorkflows,
  getSyncStatus,
  syncWithUpstream,
} from "@/services/source/fork";
import { sourceServiceDeps } from "@/application/services/source/deps.ts";

type FakeStep = {
  get?: unknown;
  all?: unknown[];
  run?: unknown;
};

function createFakeD1Database(steps: FakeStep[]) {
  let index = 0;
  const next = () => steps[index++] ?? {};
  const buildChain = () => {
    const step = next();
    const chain: any = {
      from() {
        return chain;
      },
      where() {
        return chain;
      },
      innerJoin() {
        return chain;
      },
      leftJoin() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      offset() {
        return chain;
      },
      values() {
        return chain;
      },
      set() {
        return chain;
      },
      returning() {
        return chain;
      },
      get: async () => step.get ?? null,
      first: async () => step.get ?? null,
      all: async () => step.all ?? [],
      run: async () =>
        step.run ?? {
          success: true,
          meta: { changes: 0, last_row_id: 0, duration: 0 },
        },
      raw: async () => step.all ?? [],
    };
    return chain;
  };
  return {
    select() {
      return buildChain();
    },
    insert() {
      return buildChain();
    },
    update() {
      return buildChain();
    },
    delete() {
      return buildChain();
    },
  } as unknown as D1Database;
}

function createBucketMock(): R2Bucket {
  return {
    get: async () => null,
    put: async () => undefined,
    head: async () => null,
    list: async () => ({ objects: [] }),
    delete: async () => undefined,
  } as unknown as R2Bucket;
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
  featured: false,
  installCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

Deno.test("forkWithWorkflows - throws when source repo not found", async () => {
  const db = createFakeD1Database([{ get: undefined }]);

  await assertRejects(
    () => forkWithWorkflows(db, undefined, "nonexistent", "ws-target"),
    Error,
    "Source repository not found",
  );
});

Deno.test(
  "forkWithWorkflows - throws when name already exists in target space",
  async () => {
    const db = createFakeD1Database([
      { get: sourceRepo },
      { get: { id: "existing" } },
    ]);

    await assertRejects(
      () => forkWithWorkflows(db, undefined, "source-1", "ws-target"),
      Error,
      "Repository with this name already exists in target space",
    );
  },
);

Deno.test("forkWithWorkflows - forks repo successfully", async () => {
  const db = createFakeD1Database([
    { get: sourceRepo },
    { get: undefined },
    { get: undefined },
    { get: undefined },
    {
      get: {
        ...sourceRepo,
        id: "fork-id",
        accountId: "ws-target",
        forkedFromId: "source-1",
        name: "my-fork",
      },
    },
  ]);

  const deps = sourceServiceDeps as any;
  const originalGitStore = deps.gitStore;
  deps.gitStore = {
    ...originalGitStore,
    forkRepository: async () => undefined,
  };

  try {
    const result = await forkWithWorkflows(
      db,
      undefined,
      "source-1",
      "ws-target",
      { name: "My Fork" },
    );

    assertEquals(result.repository.id, "fork-id");
    assertEquals(result.repository.name, "my-fork");
    assertEquals(result.forked_from.id, "source-1");
  } finally {
    deps.gitStore = originalGitStore;
  }
});

Deno.test("getSyncStatus - returns no-sync when repo not found", async () => {
  const db = createFakeD1Database([{ get: undefined }]);

  await assertRejects(
    () => getSyncStatus(db, undefined, "repo-1"),
    Error,
    "Repository not found",
  );
});

Deno.test("getSyncStatus - returns no-sync when repo is not a fork", async () => {
  const db = createFakeD1Database([{
    get: { ...sourceRepo, forkedFromId: null },
  }]);

  const result = await getSyncStatus(db, undefined, "repo-1");
  assertEquals(result.can_sync, false);
  assertEquals(result.upstream, null);
});

Deno.test("getSyncStatus - returns sync status for forked repo", async () => {
  const fork = { ...sourceRepo, id: "fork-1", forkedFromId: "source-1" };
  const db = createFakeD1Database([
    { get: fork },
    { get: sourceRepo },
    {
      get: {
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      all: [{
        id: "release-1",
        tag: "v1.0.0",
        name: "Release 1",
        publishedAt: "2026-01-02T00:00:00.000Z",
      }],
    },
  ]);

  const result = await getSyncStatus(db, undefined, "fork-1");
  assertEquals(result.can_sync, false);
  assertNotEquals(result.upstream, null);
  assertEquals(result.upstream!.id, "source-1");
  assertEquals(result.upstream_releases.length, 1);
});

Deno.test("syncWithUpstream - throws when repo is not a fork", async () => {
  const db = createFakeD1Database([{
    get: { ...sourceRepo, forkedFromId: null },
  }]);

  await assertRejects(
    () => syncWithUpstream(db, createBucketMock(), "repo-1"),
    Error,
    "Repository is not a fork",
  );
});

Deno.test("syncWithUpstream - throws when git storage not configured", async () => {
  const db = createFakeD1Database([
    { get: { ...sourceRepo, id: "fork-1", forkedFromId: "source-1" } },
    { get: sourceRepo },
  ]);

  await assertRejects(
    () => syncWithUpstream(db, undefined, "fork-1"),
    Error,
    "Git storage not configured",
  );
});
