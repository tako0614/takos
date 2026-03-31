import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  checkWorkspaceAccess: ((..._args: any[]) => undefined) as any,
  isValidOpaqueId: () => true,
  generateId: () => "repo-new-id",
  now: () => "2026-03-24T00:00:00.000Z",
  initRepository: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/db-guards'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
import {
  checkRepoAccess,
  createRepository,
  getRepositoryById,
  listRepositoriesBySpace,
  RepositoryCreationError,
  toApiRepositoryFromDb,
} from "@/services/source/repos";
import { sanitizeRepoName as sanitizeRepositoryName } from "@/utils";

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
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

const makeRepoRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "repo-1",
  accountId: "ws-1",
  name: "my-repo",
  description: "Test repo",
  visibility: "private",
  defaultBranch: "main",
  forkedFromId: null,
  stars: 5,
  forks: 2,
  gitEnabled: true,
  isOfficial: false,
  officialCategory: null,
  officialMaintainer: null,
  featured: false,
  installCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

Deno.test("sanitizeRepositoryName - lowercases and replaces invalid characters", () => {
  assertEquals(sanitizeRepositoryName("My Repo!"), "my-repo-");
});
Deno.test("sanitizeRepositoryName - trims whitespace", () => {
  assertEquals(sanitizeRepositoryName("  hello  "), "hello");
});
Deno.test("sanitizeRepositoryName - preserves valid characters", () => {
  assertEquals(sanitizeRepositoryName("my_repo-123"), "my_repo-123");
});

Deno.test("toApiRepositoryFromDb - maps DB row to API format", () => {
  const row = makeRepoRow();
  const result = toApiRepositoryFromDb(row as any);

  assertEquals(result.id, "repo-1");
  assertEquals(result.space_id, "ws-1");
  assertEquals(result.name, "my-repo");
  assertEquals(result.visibility, "private");
  assertEquals(result.default_branch, "main");
  assertEquals(result.stars, 5);
  assertEquals(result.forks, 2);
});
Deno.test("toApiRepositoryFromDb - normalizes public visibility", () => {
  const row = makeRepoRow({ visibility: "public" });
  const result = toApiRepositoryFromDb(row as any);
  assertEquals(result.visibility, "public");
});
Deno.test("toApiRepositoryFromDb - defaults non-public visibility to private", () => {
  const row = makeRepoRow({ visibility: "internal" });
  const result = toApiRepositoryFromDb(row as any);
  assertEquals(result.visibility, "private");
});

Deno.test("checkRepoAccess - returns null for invalid repoId", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isValidOpaqueId = (() => false) as any;
  const env = { DB: {} as D1Database } as any;
  const result = await checkRepoAccess(env, "bad-id", "user-1");
  assertEquals(result, null);
});
Deno.test("checkRepoAccess - returns null when repo not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any;
  mocks.getDb = (() => drizzle) as any;
  const env = { DB: {} as D1Database } as any;

  const result = await checkRepoAccess(env, "repo-1", "user-1");
  assertEquals(result, null);
});
Deno.test("checkRepoAccess - returns access for workspace member", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => makeRepoRow()) as any;
  mocks.getDb = (() => drizzle) as any;
  mocks.checkWorkspaceAccess =
    (async () => ({ member: { role: "editor" } })) as any;
  const env = { DB: {} as D1Database } as any;

  const result = await checkRepoAccess(env, "repo-1", "user-1");
  assertNotEquals(result, null);
  assertEquals(result!.role, "editor");
  assertEquals(result!.spaceId, "ws-1");
});
Deno.test("checkRepoAccess - allows public read for public repos when option set", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => makeRepoRow({ visibility: "public" })) as any;
  mocks.getDb = (() => drizzle) as any;
  mocks.checkWorkspaceAccess = (async () => null) as any;
  const env = { DB: {} as D1Database } as any;

  const result = await checkRepoAccess(env, "repo-1", null, undefined, {
    allowPublicRead: true,
  });
  assertNotEquals(result, null);
  assertEquals(result!.role, "viewer");
});
Deno.test("checkRepoAccess - returns null for private repos without membership", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => makeRepoRow({ visibility: "private" })) as any;
  mocks.getDb = (() => drizzle) as any;
  mocks.checkWorkspaceAccess = (async () => null) as any;
  const env = { DB: {} as D1Database } as any;

  const result = await checkRepoAccess(env, "repo-1", "user-1");
  assertEquals(result, null);
});

Deno.test("getRepositoryById - returns null for invalid id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isValidOpaqueId = (() => false) as any;
  const result = await getRepositoryById({} as D1Database, "bad");
  assertEquals(result, null);
});
Deno.test("getRepositoryById - returns mapped repo when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => makeRepoRow()) as any;
  mocks.getDb = (() => drizzle) as any;

  const result = await getRepositoryById({} as D1Database, "repo-1");
  assertNotEquals(result, null);
  assertEquals(result!.id, "repo-1");
});

Deno.test("listRepositoriesBySpace - returns empty array when no repos exist", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  mocks.getDb = (() => drizzle) as any;

  const result = await listRepositoriesBySpace({} as D1Database, "ws-1");
  assertEquals(result, []);
});
Deno.test("listRepositoriesBySpace - maps all repo rows", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    makeRepoRow(),
    makeRepoRow({ id: "repo-2", name: "second" }),
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const result = await listRepositoriesBySpace({} as D1Database, "ws-1");
  assertEquals(result.length, 2);
});

Deno.test("createRepository - throws INVALID_NAME for empty name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  await assertRejects(async () => {
    await createRepository({} as D1Database, {} as R2Bucket, {
      spaceId: "ws-1",
      name: "!!!",
    });
  }, RepositoryCreationError);
});
Deno.test("createRepository - throws SPACE_NOT_FOUND when workspace does not exist", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any; // workspace lookup
  mocks.getDb = (() => drizzle) as any;

  try {
    await createRepository({} as D1Database, {} as R2Bucket, {
      spaceId: "ws-1",
      name: "my-repo",
    });
    expect.unreachable();
  } catch (err) {
    assert(err instanceof RepositoryCreationError);
    assertEquals((err as RepositoryCreationError).code, "SPACE_NOT_FOUND");
  }
});
Deno.test("createRepository - throws REPOSITORY_EXISTS when name is taken", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => ({ id: "ws-1" })) as any // workspace found
     =
      (async () => ({ id: "existing-repo" })) as any; // existing repo
  mocks.getDb = (() => drizzle) as any;

  try {
    await createRepository({} as D1Database, {} as R2Bucket, {
      spaceId: "ws-1",
      name: "my-repo",
    });
    expect.unreachable();
  } catch (err) {
    assert(err instanceof RepositoryCreationError);
    assertEquals((err as RepositoryCreationError).code, "REPOSITORY_EXISTS");
  }
});
Deno.test("createRepository - throws GIT_STORAGE_NOT_CONFIGURED when bucket is undefined", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => ({ id: "ws-1" })) as any // workspace found
     =
      (async () => undefined) as any; // no existing repo
  mocks.getDb = (() => drizzle) as any;

  try {
    await createRepository({} as D1Database, undefined, {
      spaceId: "ws-1",
      name: "my-repo",
    });
    expect.unreachable();
  } catch (err) {
    assert(err instanceof RepositoryCreationError);
    assertEquals(
      (err as RepositoryCreationError).code,
      "GIT_STORAGE_NOT_CONFIGURED",
    );
  }
});
Deno.test("createRepository - rolls back on git init failure", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => ({ id: "ws-1" })) as any // workspace found
     =
    (async () => undefined) as any // no existing repo
     =
      (async () => undefined) as any; // actor lookup
  mocks.getDb = (() => drizzle) as any;
  mocks.initRepository = (async () => {
    throw new Error("git init failed");
  }) as any;

  try {
    await createRepository({} as D1Database, {} as R2Bucket, {
      spaceId: "ws-1",
      name: "my-repo",
    });
    expect.unreachable();
  } catch (err) {
    assert(err instanceof RepositoryCreationError);
    assertEquals((err as RepositoryCreationError).code, "INIT_FAILED");
    assert(drizzle.delete.calls.length > 0);
  }
});
Deno.test("createRepository - creates repo and initializes git successfully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get =
    (async () => ({ id: "ws-1" })) as any // workspace found
     =
    (async () => undefined) as any // no existing repo
     =
    (async () => ({
      name: "User",
      slug: "user",
      email: "user@test.com",
    })) as any // actor
     =
      (async () => makeRepoRow({ id: "repo-new-id" })) as any; // re-read after insert
  mocks.getDb = (() => drizzle) as any;
  mocks.initRepository = (async () => undefined) as any;

  const result = await createRepository({} as D1Database, {} as R2Bucket, {
    spaceId: "ws-1",
    name: "my-repo",
    actorAccountId: "user-1",
  });

  assertEquals(result.id, "repo-new-id");
  assert(drizzle.insert.calls.length > 0);
  assert(mocks.initRepository.calls.length > 0);
});
