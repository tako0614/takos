// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await no-explicit-any no-unused-vars
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert";

import {
  checkRepoAccess,
  createRepository,
  getRepositoryById,
  listRepositoriesBySpace,
  RepositoryCreationError,
  toApiRepositoryFromDb,
} from "@/services/source/repos";
import { sourceServiceDeps } from "@/application/services/source/deps.ts";
import { sanitizeRepoName as sanitizeRepositoryName } from "@/utils";

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
  const env = { DB: {} as D1Database } as any;
  const result = await checkRepoAccess(env, "bad id", "user-1");
  assertEquals(result, null);
});

Deno.test("checkRepoAccess - returns null when repo not found", async () => {
  const db = createFakeD1Database([{ get: undefined }]);
  const env = { DB: db } as any;

  const result = await checkRepoAccess(env, "repo-1", "user-1");
  assertEquals(result, null);
});

Deno.test("checkRepoAccess - allows public read for public repos when option set", async () => {
  const db = createFakeD1Database([{
    get: makeRepoRow({ visibility: "public" }),
  }]);
  const env = { DB: db } as any;

  const result = await checkRepoAccess(env, "repo-1", null, undefined, {
    allowPublicRead: true,
  });
  assertNotEquals(result, null);
  assertEquals(result!.role, "viewer");
});

Deno.test("checkRepoAccess - returns null for private repos without membership", async () => {
  const db = createFakeD1Database([{
    get: makeRepoRow({ visibility: "private" }),
  }]);
  const env = { DB: db } as any;
  const deps = sourceServiceDeps as any;
  const originalCheckSpaceAccess = deps.checkSpaceAccess;
  deps.checkSpaceAccess = async () => null;

  try {
    const result = await checkRepoAccess(env, "repo-1", "user-1");
    assertEquals(result, null);
  } finally {
    deps.checkSpaceAccess = originalCheckSpaceAccess;
  }
});

Deno.test("getRepositoryById - returns null for invalid id", async () => {
  const result = await getRepositoryById({} as D1Database, "bad id");
  assertEquals(result, null);
});

Deno.test("getRepositoryById - returns mapped repo when found", async () => {
  const db = createFakeD1Database([{ get: makeRepoRow() }]);
  const result = await getRepositoryById(db, "repo-1");
  assertNotEquals(result, null);
  assertEquals(result!.id, "repo-1");
});

Deno.test("listRepositoriesBySpace - returns empty array when no repos exist", async () => {
  const db = createFakeD1Database([{ all: [] }]);
  const result = await listRepositoriesBySpace(db, "ws-1");
  assertEquals(result, []);
});

Deno.test("listRepositoriesBySpace - maps all repo rows", async () => {
  const db = createFakeD1Database([
    {
      all: [
        makeRepoRow(),
        makeRepoRow({ id: "repo-2", name: "second" }),
      ],
    },
  ]);

  const result = await listRepositoriesBySpace(db, "ws-1");
  assertEquals(result.length, 2);
});

Deno.test("createRepository - throws INVALID_NAME for empty name", async () => {
  await assertRejects(
    () =>
      createRepository({} as D1Database, {} as R2Bucket, {
        spaceId: "ws-1",
        name: "",
      }),
    RepositoryCreationError,
  );
});

Deno.test("createRepository - throws SPACE_NOT_FOUND when space does not exist", async () => {
  const db = createFakeD1Database([{ get: undefined }]);

  await assertRejects(
    () =>
      createRepository(db, {} as R2Bucket, {
        spaceId: "ws-1",
        name: "my-repo",
      }),
    RepositoryCreationError,
  );
});

Deno.test("createRepository - throws REPOSITORY_EXISTS when name is taken", async () => {
  const db = createFakeD1Database([
    { get: { id: "ws-1" } },
    { get: { id: "existing-repo" } },
  ]);

  await assertRejects(
    () =>
      createRepository(db, {} as R2Bucket, {
        spaceId: "ws-1",
        name: "my-repo",
      }),
    RepositoryCreationError,
  );
});

Deno.test("createRepository - throws GIT_STORAGE_NOT_CONFIGURED when bucket is undefined", async () => {
  const db = createFakeD1Database([
    { get: { id: "ws-1" } },
    { get: undefined },
  ]);

  await assertRejects(
    () =>
      createRepository(db, undefined, {
        spaceId: "ws-1",
        name: "my-repo",
      }),
    RepositoryCreationError,
  );
});
