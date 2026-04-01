// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertObjectMatch,
  assertStringIncludes,
} from "jsr:@std/assert";

import { GitService } from "@/services/source/git";

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

function createBucketMock(value?: string | null) {
  return {
    get: async () =>
      value === null ? null : value === undefined ? null : ({
        text: async () => value,
        arrayBuffer: async () => new TextEncoder().encode(value).buffer,
      } as unknown),
    put: async () => undefined,
    head: async () => null,
    list: async () => ({ objects: [] }),
    delete: async () => undefined,
  } as unknown as R2Bucket;
}

Deno.test("GitService construction - creates a GitService instance", () => {
  const service = new GitService({} as D1Database, {} as R2Bucket);
  assert(service instanceof GitService);
});

Deno.test("GitService.log - returns empty array when no commits", async () => {
  const service = new GitService(
    createFakeD1Database([{ all: [] }]),
    createBucketMock(),
  );
  const result = await service.log("ws-1");
  assertEquals(result, []);
});

Deno.test("GitService.log - returns commits in mapped format", async () => {
  const service = new GitService(
    createFakeD1Database([
      {
        all: [{
          id: "c1",
          accountId: "ws-1",
          message: "init",
          authorAccountId: "user-1",
          authorName: "User",
          parentId: null,
          filesChanged: 1,
          insertions: 10,
          deletions: 0,
          treeHash: "abc123",
          createdAt: "2026-01-01T00:00:00.000Z",
        }],
      },
    ]),
    createBucketMock(),
  );
  const result = await service.log("ws-1");

  assertEquals(result.length, 1);
  assertObjectMatch(result[0], {
    id: "c1",
    space_id: "ws-1",
    message: "init",
    author_id: "user-1",
    parent_id: null,
    files_changed: 1,
  });
});

Deno.test("GitService.log - filters by path when provided", async () => {
  const service = new GitService(
    createFakeD1Database([
      { all: [{ commitId: "c1" }] },
      {
        all: [{
          id: "c1",
          accountId: "ws-1",
          message: "edit file",
          authorAccountId: "user-1",
          authorName: "User",
          parentId: null,
          filesChanged: 1,
          insertions: 1,
          deletions: 0,
          treeHash: "abc",
          createdAt: "2026-01-01T00:00:00.000Z",
        }],
      },
    ]),
    createBucketMock(),
  );
  const result = await service.log("ws-1", { path: "src/main.ts" });

  assertEquals(result.length, 1);
  assertEquals(result[0].id, "c1");
});

Deno.test("GitService.log - returns empty when path filter has no matching commits", async () => {
  const service = new GitService(
    createFakeD1Database([{ all: [] }]),
    createBucketMock(),
  );
  const result = await service.log("ws-1", { path: "nonexistent.ts" });

  assertEquals(result, []);
});

Deno.test("GitService.getCommit - returns null when commit not found", async () => {
  const service = new GitService(
    createFakeD1Database([{ get: null }]),
    createBucketMock(),
  );
  const result = await service.getCommit("nonexistent");

  assertEquals(result, null);
});

Deno.test("GitService.getCommit - returns commit when found", async () => {
  const service = new GitService(
    createFakeD1Database([
      {
        get: {
          id: "c1",
          accountId: "ws-1",
          message: "init",
          authorAccountId: "user-1",
          authorName: "User",
          parentId: null,
          filesChanged: 0,
          insertions: 0,
          deletions: 0,
          treeHash: "abc",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ]),
    createBucketMock(),
  );
  const result = await service.getCommit("c1");

  assertNotEquals(result, null);
  assertEquals(result!.id, "c1");
});

Deno.test("GitService.getCommitChanges - returns empty when no changes", async () => {
  const service = new GitService(
    createFakeD1Database([{ all: [] }]),
    createBucketMock(),
  );
  const result = await service.getCommitChanges("c1");

  assertEquals(result, []);
});

Deno.test("GitService.getCommitChanges - maps change rows correctly", async () => {
  const service = new GitService(
    createFakeD1Database([
      {
        all: [{
          id: "ch-1",
          commitId: "c1",
          fileId: "f1",
          path: "src/main.ts",
          changeType: "added",
          oldPath: null,
          oldHash: null,
          newHash: "hash1",
          insertions: 10,
          deletions: 0,
        }],
      },
    ]),
    createBucketMock(),
  );
  const result = await service.getCommitChanges("c1");

  assertEquals(result.length, 1);
  assertObjectMatch(result[0], {
    id: "ch-1",
    commit_id: "c1",
    path: "src/main.ts",
    change_type: "added",
  });
});

Deno.test("GitService.restore - returns failure when change not found", async () => {
  const service = new GitService(
    createFakeD1Database([{ get: null }]),
    createBucketMock(),
  );
  const result = await service.restore("ws-1", "c1", "missing.ts");

  assertEquals(result.success, false);
  assertEquals(result.message, "File not found in commit");
});

Deno.test("GitService.restore - returns failure for deleted files", async () => {
  const service = new GitService(
    createFakeD1Database([{ get: { changeType: "deleted" } }]),
    createBucketMock(),
  );
  const result = await service.restore("ws-1", "c1", "deleted.ts");

  assertEquals(result.success, false);
  assertStringIncludes(result.message, "Cannot restore deleted file");
});

Deno.test("GitService.restore - returns failure when snapshot not found", async () => {
  const service = new GitService(
    createFakeD1Database([{
      get: { changeType: "modified", newHash: "hash1" },
    }]),
    createBucketMock(null),
  );
  const result = await service.restore("ws-1", "c1", "src/main.ts");

  assertEquals(result.success, false);
  assertEquals(result.message, "Snapshot not found");
});
