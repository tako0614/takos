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

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
import {
  type RuntimeSessionDeps,
  runtimeSessionDeps,
  RuntimeSessionManager,
} from "@/services/sync/runtime-session";

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

function makeManager(
  options: {
    envOverrides?: Record<string, unknown>;
    depsOverrides?: Partial<RuntimeSessionDeps>;
    storageOverride?: MockR2Bucket | undefined;
  } = {},
) {
  const env = {
    DB: db,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    ...options.envOverrides,
  } as never;
  const storageValue = "storageOverride" in options
    ? options.storageOverride
    : storage;

  return new RuntimeSessionManager(
    env,
    db as never,
    storageValue as never,
    spaceId,
    sessionId,
    {
      ...runtimeSessionDeps,
      ...options.depsOverrides,
    },
  );
}

const db = new MockD1Database();
const storage = new MockR2Bucket();
const spaceId = "space-1";
const sessionId = "session-1";

Deno.test("RuntimeSessionManager - setRepositoryInfo - sets repoId, branch, and repoName", () => {
  const mgr = makeManager();
  mgr.setRepositoryInfo("repo-1", "main", "my-repo");
  assertEquals(mgr.isGitMode(), true);
});

Deno.test("RuntimeSessionManager - setRepositories - sets multiple repos and picks primary", () => {
  const mgr = makeManager();
  mgr.setRepositories([
    { repoId: "r1", repoName: "repo-1", branch: "main" },
    { repoId: "r2", repoName: "repo-2", branch: "dev" },
  ], "r2");
  assertEquals(mgr.isGitMode(), true);
});
Deno.test("RuntimeSessionManager - setRepositories - defaults to first repo when primaryRepoId is not specified", () => {
  const mgr = makeManager();
  mgr.setRepositories([{ repoId: "r1", repoName: "repo-1" }]);
  assertEquals(mgr.isGitMode(), true);
});

Deno.test("RuntimeSessionManager - isGitMode - returns false when no repo is set", () => {
  const mgr = makeManager();
  assertEquals(mgr.isGitMode(), false);
});

Deno.test("RuntimeSessionManager - initSession - throws when session is not found and skipDbLock is false", async () => {
  const drizzle = createMockDrizzle();
  const mgr = makeManager({
    envOverrides: { GIT_OBJECTS: storage },
    depsOverrides: { getDb: () => drizzle as never },
  });
  mgr.setRepositoryInfo("repo-1", "main");

  await assertRejects(async () => {
    await mgr.initSession();
  }, "Session not found");
});
Deno.test("RuntimeSessionManager - initSession - throws when session is already running", async () => {
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
  const mgr = makeManager({
    envOverrides: { GIT_OBJECTS: storage },
    depsOverrides: { getDb: () => drizzle as never },
  });
  mgr.setRepositoryInfo("repo-1", "main");

  await assertRejects(async () => {
    await mgr.initSession();
  }, "Session is already initialized");
});
Deno.test("RuntimeSessionManager - initSession - throws when repo_id is not set and skipDbLock is true", async () => {
  const mgr = makeManager({
    envOverrides: { GIT_OBJECTS: storage },
  });
  // No repo set

  await assertRejects(async () => {
    await mgr.initSession({ skipDbLock: true });
  }, "repo_id is required");
});

Deno.test("RuntimeSessionManager - cloneRepository - returns clone result from runtime", async () => {
  const mgr = makeManager({
    envOverrides: { GIT_OBJECTS: storage },
    depsOverrides: {
      callRuntimeRequest: (async () =>
        new Response(
          JSON.stringify({
            success: true,
            targetDir: "/tmp/repo",
            branch: "main",
          }),
          { status: 200 },
        )) as any,
    },
  });
  const result = await mgr.cloneRepository("my-repo", "main", "/tmp/repo");

  assertEquals(result.success, true);
  assertEquals(result.branch, "main");
});
Deno.test("RuntimeSessionManager - cloneRepository - returns error on failed response", async () => {
  const mgr = makeManager({
    envOverrides: { GIT_OBJECTS: storage },
    depsOverrides: {
      callRuntimeRequest: (async () =>
        new Response(JSON.stringify({ error: "clone failed" }), {
          status: 500,
        })) as any,
    },
  });
  const result = await mgr.cloneRepository("my-repo", "main", "/tmp/repo");

  assertEquals(result.success, false);
  assertEquals(result.error, "clone failed");
});

Deno.test("RuntimeSessionManager - commitChanges - returns commit result from runtime", async () => {
  const mgr = makeManager({
    depsOverrides: {
      callRuntimeRequest: (async () =>
        new Response(
          JSON.stringify({
            success: true,
            committed: true,
            commitHash: "abc123",
          }),
          { status: 200 },
        )) as any,
    },
  });
  const result = await mgr.commitChanges("/tmp/repo", "test commit");

  assertEquals(result.success, true);
  assertEquals(result.commitHash, "abc123");
});

Deno.test("RuntimeSessionManager - pushChanges - returns push result from runtime", async () => {
  const mgr = makeManager({
    depsOverrides: {
      callRuntimeRequest: (async () =>
        new Response(JSON.stringify({ success: true, branch: "main" }), {
          status: 200,
        })) as any,
    },
  });
  const result = await mgr.pushChanges("/tmp/repo", "main");

  assertEquals(result.success, true);
  assertEquals(result.branch, "main");
});
Deno.test("RuntimeSessionManager - pushChanges - returns error on failure", async () => {
  const mgr = makeManager({
    depsOverrides: {
      callRuntimeRequest: (async () =>
        new Response(JSON.stringify({ error: "push failed" }), {
          status: 500,
        })) as any,
    },
  });
  const result = await mgr.pushChanges("/tmp/repo");

  assertEquals(result.success, false);
  assertEquals(result.branch, "unknown");
});

Deno.test("RuntimeSessionManager - getWorkDir - returns session directory path on success", async () => {
  const mgr = makeManager({
    depsOverrides: {
      callRuntimeRequest: (async () =>
        new Response("{}", { status: 200 })) as any,
    },
  });
  const dir = await mgr.getWorkDir();

  assertEquals(dir, `/tmp/takos-session-${sessionId}`);
});
Deno.test("RuntimeSessionManager - getWorkDir - returns null on failed response", async () => {
  const mgr = makeManager({
    depsOverrides: {
      callRuntimeRequest: (async () =>
        new Response("error", { status: 500 })) as any,
    },
  });
  const dir = await mgr.getWorkDir();

  assertEquals(dir, null);
});

Deno.test("RuntimeSessionManager - syncToGit - returns error when no repoId is set", async () => {
  const mgr = makeManager();
  // no repo set
  const result = await mgr.syncToGit();

  assertEquals(result.success, false);
  assertEquals(result.error, "Repository ID not set");
});

Deno.test("RuntimeSessionManager - syncSnapshotToRepo - returns error when storage bucket is not configured", async () => {
  const mgr = makeManager({ storageOverride: undefined });

  const result = await mgr.syncSnapshotToRepo(
    { files: [{ path: "a.txt", content: "hi", size: 2 }], file_count: 1 },
    { repoId: "repo-1", message: "test" },
  );
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? "", "R2 storage bucket not configured");
});
Deno.test("RuntimeSessionManager - syncSnapshotToRepo - returns error when repoId is empty", async () => {
  const mgr = makeManager({
    envOverrides: { GIT_OBJECTS: storage },
  });

  const result = await mgr.syncSnapshotToRepo(
    { files: [], file_count: 0 },
    { repoId: "", message: "test" },
  );
  assertEquals(result.success, false);
  assertEquals(result.error, "Repository ID not set");
});
Deno.test("RuntimeSessionManager - syncSnapshotToRepo - returns success with committed=false when no files after filtering", async () => {
  const mgr = makeManager({
    envOverrides: { GIT_OBJECTS: storage },
  });

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
  const mgr = makeManager({
    depsOverrides: {
      callRuntimeRequest: (async () =>
        new Response("ok", { status: 200 })) as any,
    },
  });
  await mgr.destroySession();
});
Deno.test("RuntimeSessionManager - destroySession - does not throw when runtime call fails", async () => {
  const mgr = makeManager({
    depsOverrides: {
      callRuntimeRequest: (async () => {
        throw new Error("network error");
      }) as any,
    },
  });

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
    runtimeSessionDeps,
  );
  assert(mgr instanceof RuntimeSessionManager);
});
