import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../../hono-test-support.ts";

import { assert, assertEquals } from "@std/assert";
import { asyncNoopDep, noopDep } from "@test/dep-stubs";

type RecordedCalls = { calls: Array<{ args: unknown[] }> };
type LooseAsyncFn =
  & ((...args: unknown[]) => Promise<unknown>)
  & Partial<RecordedCalls>;
type LooseFn =
  & ((...args: unknown[]) => unknown)
  & Partial<RecordedCalls>;

const mocks: {
  findRepoByUsernameAndName: LooseAsyncFn;
  getUserByUsername: LooseAsyncFn;
  getUserStats: LooseAsyncFn;
  isFollowing: LooseAsyncFn;
  batchStarCheck: LooseAsyncFn;
  getUserPrivacySettings: LooseAsyncFn;
  isMutedBy: LooseAsyncFn;
  getDb: LooseFn;
  listBranches: LooseAsyncFn;
  getDefaultBranch: LooseAsyncFn;
  resolveReadableCommitFromRef: LooseAsyncFn;
  listDirectory: LooseAsyncFn;
  getBlobAtPath: LooseAsyncFn;
  getCommitsFromRef: LooseAsyncFn;
  checkWorkspaceAccess: LooseAsyncFn;
} = {
  findRepoByUsernameAndName: asyncNoopDep(
    "profilesRepoRouteDeps.findRepoByUsernameAndName",
  ),
  getUserByUsername: asyncNoopDep("profilesRepoRouteDeps.getUserByUsername"),
  getUserStats: asyncNoopDep("profilesRepoRouteDeps.getUserStats"),
  isFollowing: asyncNoopDep("profilesRepoRouteDeps.isFollowing"),
  batchStarCheck: asyncNoopDep("profilesRepoRouteDeps.batchStarCheck"),
  getUserPrivacySettings: asyncNoopDep(
    "profilesRepoRouteDeps.getUserPrivacySettings",
  ),
  isMutedBy: asyncNoopDep("profilesRepoRouteDeps.isMutedBy"),
  getDb: noopDep("profilesRepoRouteDeps.getDb"),
  listBranches: asyncNoopDep("profilesRepoRouteDeps.listBranches"),
  getDefaultBranch: asyncNoopDep("profilesRepoRouteDeps.getDefaultBranch"),
  resolveReadableCommitFromRef: asyncNoopDep(
    "profilesRepoRouteDeps.resolveReadableCommitFromRef",
  ),
  listDirectory: asyncNoopDep("profilesRepoRouteDeps.listDirectory"),
  getBlobAtPath: asyncNoopDep("profilesRepoRouteDeps.getBlobAtPath"),
  getCommitsFromRef: asyncNoopDep("profilesRepoRouteDeps.getCommitsFromRef"),
  checkWorkspaceAccess: asyncNoopDep(
    "profilesRepoRouteDeps.checkWorkspaceAccess",
  ),
};

function createRecordedMock<
  T extends (...args: never[]) => unknown,
>(impl: T) {
  const fn = ((...args: Parameters<T>) => {
    fn.calls.push({ args });
    return impl(...args);
  }) as T & { calls: Array<{ args: Parameters<T> }> };
  fn.calls = [];
  return fn;
}

// [Deno] vi.mock removed - manually stub imports from '@/routes/profiles/shared'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/db/schema'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/takos-git/local'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
import profilesRepo, { profilesRepoRouteDeps } from "@/routes/profiles/repo";

type OptionalUserVars = { user?: User };
type TestEnv = { Bindings: Env; Variables: OptionalUserVars };

function createUser(): User {
  return {
    id: "user-1",
    email: "user1@example.com",
    name: "User One",
    username: "user1",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
}

function bindMock<K extends keyof typeof profilesRepoRouteDeps>(
  mockKey: keyof typeof mocks,
): typeof profilesRepoRouteDeps[K] {
  return ((...args: unknown[]) => {
    type AnyFn = (...a: unknown[]) => unknown;
    return (mocks[mockKey] as AnyFn)(...args);
  }) as typeof profilesRepoRouteDeps[K];
}

function createApp(user?: User) {
  const app = new Hono<TestEnv>();
  installAppErrorHandler(app);
  Object.assign(profilesRepoRouteDeps, {
    findRepoByUsernameAndName: bindMock<"findRepoByUsernameAndName">(
      "findRepoByUsernameAndName",
    ),
    getDb: bindMock<"getDb">("getDb"),
    checkSpaceAccess: bindMock<"checkSpaceAccess">("checkWorkspaceAccess"),
    listBranches: bindMock<"listBranches">("listBranches"),
    resolveReadableCommitFromRef: bindMock<"resolveReadableCommitFromRef">(
      "resolveReadableCommitFromRef",
    ),
    listDirectory: bindMock<"listDirectory">("listDirectory"),
    getBlobAtPath: bindMock<"getBlobAtPath">("getBlobAtPath"),
    getCommitsFromRef: bindMock<"getCommitsFromRef">("getCommitsFromRef"),
    getDefaultBranch: bindMock<"getDefaultBranch">("getDefaultBranch"),
  });
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.route("/", profilesRepo);
  return app;
}

function mockDbChain(results: unknown[] = []) {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    innerJoin: () => chain,
    all: async () => results,
    get: async () => results[0] ?? null,
    update: createRecordedMock(() => ({
      set: () => ({ where: async () => undefined }),
    })),
    delete: createRecordedMock(() => ({ where: async () => undefined })),
  };
  mocks.getDb = () => chain;
  return chain;
}

const env = createMockEnv();

Deno.test("profiles repo routes - GET /:username/:repoName - returns 404 when repo not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = createRecordedMock(async () => null);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/user1/nonexistent"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("profiles repo routes - GET /:username/:repoName - skips reserved paths (repos, stars, followers, following)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = createRecordedMock(async () => null);
  for (const reserved of ["repos", "stars", "followers", "following"]) {
    const app = createApp(createUser());
    const res = await app.fetch(
      new Request(`http://localhost/user1/${reserved}`),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 404);
    assertEquals(mocks.findRepoByUsernameAndName.calls?.length ?? 0, 0);
  }
});
Deno.test("profiles repo routes - GET /:username/:repoName - returns repository data when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = async () => ({
    repo: {
      id: "repo-1",
      name: "my-repo",
      description: "A test repo",
      visibility: "public",
      default_branch: "main",
      stars: 5,
      forks: 2,
      forked_from_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    },
    space: { name: "Personal", id: "ws-1" },
    owner: {
      name: "User One",
      username: "user1",
      picture: null,
    },
  });
  mocks.listBranches = async () => [{ name: "main", is_default: true }];
  const chain = mockDbChain([]);
  chain.get = async () => null; // no star

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/user1/my-repo"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as {
    repository: { name: string; stars: number };
    branch_count: number;
    starred: boolean;
  };
  assertEquals(json.repository.name, "my-repo");
  assertEquals(json.repository.stars, 5);
  assertEquals(json.branch_count, 1);
  assertEquals(json.starred, false);
});
Deno.test("profiles repo routes - GET /:username/:repoName - works for anonymous users (no starred check)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = async () => ({
    repo: {
      id: "repo-1",
      name: "public-repo",
      description: null,
      visibility: "public",
      default_branch: "main",
      stars: 0,
      forks: 0,
      forked_from_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    space: { name: "Test", id: "ws-1" },
    owner: { name: "Owner", username: "owner1", picture: null },
  });
  mocks.listBranches = async () => [];
  mockDbChain([]);

  const app = createApp(); // no user
  const res = await app.fetch(
    new Request("http://localhost/owner1/public-repo"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as { starred: boolean };
  assertEquals(json.starred, false);
});

Deno.test("profiles repo routes - GET /:username/:repoName/branches - returns 404 when repo not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = async () => null;

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/user1/missing/branches"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("profiles repo routes - GET /:username/:repoName/branches - returns branches list and default branch", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = async () => ({
    repo: { id: "repo-1", default_branch: "main" },
    space: { name: "W" },
    owner: { username: "user1" },
  });
  mocks.listBranches = async () => [
    { name: "main", is_default: true, commit_sha: "abc123" },
    { name: "feature", is_default: false, commit_sha: "def456" },
  ];
  mocks.getDefaultBranch = async () => ({ name: "main" });

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/user1/repo/branches"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as {
    branches: Array<{ name: string }>;
    default_branch: string;
  };
  assertEquals(json.branches.length, 2);
  assertEquals(json.default_branch, "main");
});

Deno.test("profiles repo routes - GET /:username/:repoName/commits - returns 404 when repo not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = async () => null;

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/user1/missing/commits"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("profiles repo routes - GET /:username/:repoName/commits - returns commits from the default branch", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = async () => ({
    repo: { id: "repo-1", default_branch: "main" },
    space: { name: "W" },
    owner: { username: "user1" },
  });
  mocks.getCommitsFromRef = async () => [
    {
      sha: "abc123456789",
      author: {
        name: "Author",
        email: "a@b.com",
        timestamp: "2026-01-01T00:00:00Z",
      },
      message: "Initial commit",
    },
  ];

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/user1/repo/commits"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as {
    commits: Array<{ hash: string; short_hash: string; message: string }>;
  };
  assertEquals(json.commits.length, 1);
  assertEquals(json.commits[0].hash, "abc123456789");
  assertEquals(json.commits[0].short_hash, "abc1234");
  assertEquals(json.commits[0].message, "Initial commit");
});

Deno.test("profiles repo routes - DELETE /:username/:repoName - returns 401 for anonymous users", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const app = createApp(); // no user
  const res = await app.fetch(
    new Request("http://localhost/user1/repo", { method: "DELETE" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 401);
});
Deno.test("profiles repo routes - DELETE /:username/:repoName - returns 404 when repo not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/user1/missing", { method: "DELETE" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("profiles repo routes - DELETE /:username/:repoName - returns 403 when user lacks owner/admin role", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = async () => ({
    repo: { id: "repo-1", forked_from_id: null },
    space: { id: "ws-1" },
    owner: { username: "user1" },
  });
  mocks.checkWorkspaceAccess = async () => ({
    membership: { role: "viewer" },
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/user1/repo", { method: "DELETE" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});
Deno.test("profiles repo routes - DELETE /:username/:repoName - deletes repo when user has owner role", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.findRepoByUsernameAndName = async () => ({
    repo: { id: "repo-1", forked_from_id: null },
    space: { id: "ws-1" },
    owner: { username: "user1" },
  });
  mocks.checkWorkspaceAccess = async () => ({
    membership: { role: "owner" },
  });
  const chain = mockDbChain([]);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/user1/repo", { method: "DELETE" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as { success: boolean };
  assertEquals(json.success, true);
  // Verify cascading deletes were called
  assert(chain.delete.calls.length > 0);
});
