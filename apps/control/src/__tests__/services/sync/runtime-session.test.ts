import {
  MockD1Database,
  MockR2Bucket,
} from "../../../../test/integration/setup.ts";

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCalls } from "jsr:@std/testing/mock";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  callRuntimeRequest: ((..._args: any[]) => undefined) as any,
  resolveRef: ((..._args: any[]) => undefined) as any,
  getCommitData: ((..._args: any[]) => undefined) as any,
  flattenTree: ((..._args: any[]) => undefined) as any,
  getBlob: ((..._args: any[]) => undefined) as any,
  putBlob: ((..._args: any[]) => undefined) as any,
  buildTreeFromPaths: ((..._args: any[]) => undefined) as any,
  createCommit: ((..._args: any[]) => undefined) as any,
  updateBranch: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
import { RuntimeSessionManager } from "@/services/sync/runtime-session";

function createMockDrizzle(overrides: Record<string, unknown> = {}) {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.get = async () => null;
    c.all = async () => [];
    c.run = async () => ({ meta: { changes: 1 } });
    return c;
  };

  return {
    select: () => chain(),
    update: () => {
      const c: Record<string, unknown> = {};
      c.set = () => c;
      c.where = () => c;
      c.run = async () => ({ meta: { changes: 1 } });
      return c;
    },
    insert: () => {
      const c: Record<string, unknown> = {};
      c.values = () => c;
      c.run = async () => ({ meta: { changes: 1 } });
      return c;
    },
    ...overrides,
  };
}

const db = new MockD1Database();
const storage = new MockR2Bucket();
const spaceId = "space-1";
const sessionId = "session-1";

Deno.test("RuntimeSessionManager - setRepositoryInfo - sets repoId, branch, and repoName", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  mgr.setRepositoryInfo("repo-1", "main", "my-repo");
  assertEquals(mgr.isGitMode(), true);
});

Deno.test("RuntimeSessionManager - setRepositories - sets multiple repos and picks primary", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  mgr.setRepositories([
    { repoId: "r1", repoName: "repo-1", branch: "main" },
    { repoId: "r2", repoName: "repo-2", branch: "dev" },
  ], "r2");
  assertEquals(mgr.isGitMode(), true);
});
Deno.test("RuntimeSessionManager - setRepositories - defaults to first repo when primaryRepoId is not specified", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  mgr.setRepositories([{ repoId: "r1", repoName: "repo-1" }]);
  assertEquals(mgr.isGitMode(), true);
});

Deno.test("RuntimeSessionManager - isGitMode - returns false when no repo is set", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  assertEquals(mgr.isGitMode(), false);
});

Deno.test("RuntimeSessionManager - initSession - throws when session is not found and skipDbLock is false", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createMockDrizzle();
  // session select returns null (not found)
  mocks.getDb = (() => drizzle) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    GIT_OBJECTS: storage,
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  mgr.setRepositoryInfo("repo-1", "main");

  await assertRejects(async () => {
    await mgr.initSession();
  }, "Session not found");
});
Deno.test("RuntimeSessionManager - initSession - throws when session is already running", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const selectChain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    get: async () => ({ status: "running" }),
  };
  const drizzle = createMockDrizzle();
  drizzle.select = () => selectChain;
  mocks.getDb = (() => drizzle) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    GIT_OBJECTS: storage,
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  mgr.setRepositoryInfo("repo-1", "main");

  await assertRejects(async () => {
    await mgr.initSession();
  }, "Session is already initialized");
});
Deno.test("RuntimeSessionManager - initSession - throws when repo_id is not set and skipDbLock is true", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    GIT_OBJECTS: storage,
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  // No repo set

  await assertRejects(async () => {
    await mgr.initSession({ skipDbLock: true });
  }, "repo_id is required");
});

Deno.test("RuntimeSessionManager - cloneRepository - returns clone result from runtime", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () =>
    new Response(
      JSON.stringify({
        success: true,
        targetDir: "/tmp/repo",
        branch: "main",
      }),
      { status: 200 },
    )) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    GIT_OBJECTS: storage,
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  const result = await mgr.cloneRepository("my-repo", "main", "/tmp/repo");

  assertEquals(result.success, true);
  assertEquals(result.branch, "main");
});
Deno.test("RuntimeSessionManager - cloneRepository - returns error on failed response", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest =
    (async () =>
      new Response(JSON.stringify({ error: "clone failed" }), {
        status: 500,
      })) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    GIT_OBJECTS: storage,
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  const result = await mgr.cloneRepository("my-repo", "main", "/tmp/repo");

  assertEquals(result.success, false);
  assertEquals(result.error, "clone failed");
});

Deno.test("RuntimeSessionManager - commitChanges - returns commit result from runtime", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () =>
    new Response(
      JSON.stringify({
        success: true,
        committed: true,
        commitHash: "abc123",
      }),
      { status: 200 },
    )) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  const result = await mgr.commitChanges("/tmp/repo", "test commit");

  assertEquals(result.success, true);
  assertEquals(result.commitHash, "abc123");
});

Deno.test("RuntimeSessionManager - pushChanges - returns push result from runtime", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest =
    (async () =>
      new Response(JSON.stringify({ success: true, branch: "main" }), {
        status: 200,
      })) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  const result = await mgr.pushChanges("/tmp/repo", "main");

  assertEquals(result.success, true);
  assertEquals(result.branch, "main");
});
Deno.test("RuntimeSessionManager - pushChanges - returns error on failure", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest =
    (async () =>
      new Response(JSON.stringify({ error: "push failed" }), {
        status: 500,
      })) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  const result = await mgr.pushChanges("/tmp/repo");

  assertEquals(result.success, false);
  assertEquals(result.branch, "unknown");
});

Deno.test("RuntimeSessionManager - getWorkDir - returns session directory path on success", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest =
    (async () => new Response("{}", { status: 200 })) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  const dir = await mgr.getWorkDir();

  assertEquals(dir, `/tmp/takos-session-${sessionId}`);
});
Deno.test("RuntimeSessionManager - getWorkDir - returns null on failed response", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest =
    (async () => new Response("error", { status: 500 })) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  const dir = await mgr.getWorkDir();

  assertEquals(dir, null);
});

Deno.test("RuntimeSessionManager - syncToGit - returns error when no repoId is set", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  // no repo set
  const result = await mgr.syncToGit();

  assertEquals(result.success, false);
  assertEquals(result.error, "Repository ID not set");
});

Deno.test("RuntimeSessionManager - syncSnapshotToRepo - returns error when storage bucket is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    undefined,
    spaceId,
    sessionId,
  );

  const result = await mgr.syncSnapshotToRepo(
    { files: [{ path: "a.txt", content: "hi", size: 2 }], file_count: 1 },
    { repoId: "repo-1", message: "test" },
  );
  assertEquals(result.success, false);
  assertStringIncludes(result.error, "R2 storage bucket not configured");
});
Deno.test("RuntimeSessionManager - syncSnapshotToRepo - returns error when repoId is empty", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    GIT_OBJECTS: storage,
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );

  const result = await mgr.syncSnapshotToRepo(
    { files: [], file_count: 0 },
    { repoId: "", message: "test" },
  );
  assertEquals(result.success, false);
  assertEquals(result.error, "Repository ID not set");
});
Deno.test("RuntimeSessionManager - syncSnapshotToRepo - returns success with committed=false when no files after filtering", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resolveRef = (async () => null) as any;
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    GIT_OBJECTS: storage,
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );

  const result = await mgr.syncSnapshotToRepo(
    {
      files: [{ path: ".takos-session", content: "x", size: 1 }],
      file_count: 1,
    },
    { repoId: "repo-1", message: "test" },
  );
  assertEquals(result.success, true);
  assertEquals(result.committed, false);
});

Deno.test("RuntimeSessionManager - destroySession - calls runtime destroy endpoint without throwing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest =
    (async () => new Response("ok", { status: 200 })) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );
  await mgr.destroySession();

  assertSpyCalls(mocks.callRuntimeRequest, 1);
});
Deno.test("RuntimeSessionManager - destroySession - does not throw when runtime call fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => {
    throw new Error("network error");
  }) as any;

  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    spaceId,
    sessionId,
  );

  // Should not throw
  await mgr.destroySession();
});

Deno.test("RuntimeSessionManager constructor - creates a RuntimeSessionManager instance", () => {
  const db = new MockD1Database();
  const storage = new MockR2Bucket();
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
  } as never;
  const mgr = new RuntimeSessionManager(
    env,
    db as never,
    storage as never,
    "sp",
    "sess",
  );
  assert(mgr instanceof RuntimeSessionManager);
});
