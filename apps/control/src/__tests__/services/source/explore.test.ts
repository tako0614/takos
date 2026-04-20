// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await
import { assertEquals } from "jsr:@std/assert";

import type { D1Database } from "@cloudflare/workers-types";

import {
  listExploreRepos,
  listNewRepos,
  listRecentRepos,
  listTrendingRepos,
} from "@/services/source/explore";

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

const makeRepoRow = (id: string, stars = 5) => ({
  id,
  name: `repo-${id}`,
  description: "A test repo",
  defaultBranch: "main",
  stars,
  forks: 0,
  primaryLanguage: null,
  license: null,
  createdAt: "2026-03-20T00:00:00.000Z",
  updatedAt: "2026-03-20T00:00:00.000Z",
  accountId: "owner-1",
  accountName: "Owner",
  accountSlug: "owner",
  accountPicture: null,
});

Deno.test("listExploreRepos - returns empty result when no repos", async () => {
  const db = createFakeD1Database([
    { all: [] },
    { get: { count: 0 } },
  ]);

  const result = await listExploreRepos(db, {
    sort: "stars",
    order: "desc",
    limit: 10,
    offset: 0,
    searchQuery: "",
  });

  assertEquals(result.repos.length, 0);
  assertEquals(result.total, 0);
  assertEquals(result.has_more, false);
});

Deno.test("listExploreRepos - maps repos with starred status", async () => {
  const db = createFakeD1Database([
    { all: [makeRepoRow("r1", 10)] },
    { get: { count: 1 } },
    { all: [{ repoId: "r1" }] },
  ]);

  const result = await listExploreRepos(db, {
    sort: "stars",
    order: "desc",
    limit: 10,
    offset: 0,
    searchQuery: "",
    userId: "user-1",
  });

  assertEquals(result.repos.length, 1);
  assertEquals(result.repos[0].id, "r1");
  assertEquals(result.repos[0].is_starred, true);
  assertEquals(result.repos[0].visibility, "public");
});

Deno.test("listExploreRepos - computes has_more correctly", async () => {
  const db = createFakeD1Database([
    { all: [makeRepoRow("r1")] },
    { get: { count: 5 } },
  ]);

  const result = await listExploreRepos(db, {
    sort: "stars",
    order: "desc",
    limit: 1,
    offset: 0,
    searchQuery: "",
  });

  assertEquals(result.has_more, true);
  assertEquals(result.total, 5);
});

Deno.test("listTrendingRepos - returns trending repos ordered by stars", async () => {
  const db = createFakeD1Database([
    { all: [makeRepoRow("r1", 50), makeRepoRow("r2", 20)] },
    { get: { count: 2 } },
  ]);

  const result = await listTrendingRepos(db, {
    limit: 10,
    offset: 0,
  });

  assertEquals(result.repos.length, 2);
  assertEquals(result.total, 2);
});

Deno.test("listNewRepos - returns newly created repos", async () => {
  const db = createFakeD1Database([
    { all: [makeRepoRow("r1")] },
    { get: { count: 1 } },
  ]);

  const result = await listNewRepos(db, { limit: 10, offset: 0 });

  assertEquals(result.repos.length, 1);
});

Deno.test("listRecentRepos - returns recently updated repos", async () => {
  const db = createFakeD1Database([
    { all: [makeRepoRow("r1")] },
    { get: { count: 1 } },
  ]);

  const result = await listRecentRepos(db, { limit: 10, offset: 0 });

  assertEquals(result.repos.length, 1);
  assertEquals(result.repos[0].owner.username, "owner");
});
