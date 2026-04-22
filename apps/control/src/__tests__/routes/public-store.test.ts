import { Hono } from "hono";
import type { Env } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { assertEquals } from "jsr:@std/assert";
import publicStoreRoutes, {
  setPublicStoreRouteTestDeps,
} from "@/routes/public-store/routes.ts";

const STORE = {
  id: "https://test.takos.jp/api/public/stores/curated",
  slug: "curated",
  name: "Curated",
  summary: "Shared repository references",
  icon_url: null,
  repository_count: 1,
  inventory_url: "https://test.takos.jp/api/public/stores/curated/inventory",
  search_url:
    "https://test.takos.jp/api/public/stores/curated/search/repositories",
  feed_url: "https://test.takos.jp/api/public/stores/curated/feed",
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-02T00:00:00.000Z",
};

const REPOSITORY = {
  id: "repo-ref-1",
  owner: "alice",
  name: "demo",
  summary: "Demo repo",
  repository_url: "https://test.takos.jp/@alice/demo",
  clone_url: "https://test.takos.jp/git/alice/demo.git",
  browse_url: "https://test.takos.jp/@alice/demo",
  default_branch: "main",
  default_branch_hash: "abc123",
  package_icon: "/icons/demo.svg",
  source: "local" as const,
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-02T00:00:00.000Z",
};

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  app.route("/api/public/stores", publicStoreRoutes);
  return app;
}

function env(): Env {
  return createMockEnv() as unknown as Env;
}

Deno.test("public store routes - serves store document without auth", async () => {
  setPublicStoreRouteTestDeps({
    getPublicStoreDocument: async (_db, origin, storeSlug) => ({
      ...STORE,
      id: `${origin}/api/public/stores/${storeSlug}`,
    }),
  });

  const response = await createApp().fetch(
    new Request("https://test.takos.jp/api/public/stores/curated"),
    env(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    store: {
      ...STORE,
      id: "https://test.takos.jp/api/public/stores/curated",
    },
  });
});

Deno.test("public store routes - lists inventory with repository references", async () => {
  let observed:
    | { origin: string; storeSlug: string; limit: number; offset: number }
    | null = null;
  setPublicStoreRouteTestDeps({
    listPublicStoreInventory: async (_db, origin, storeSlug, options) => {
      observed = { origin, storeSlug, ...options };
      return { store: STORE, total: 1, items: [REPOSITORY] };
    },
  });

  const response = await createApp().fetch(
    new Request(
      "https://test.takos.jp/api/public/stores/curated/inventory?limit=2&offset=4",
    ),
    env(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(observed, {
    origin: "https://test.takos.jp",
    storeSlug: "curated",
    limit: 2,
    offset: 4,
  });
  assertEquals(await response.json(), {
    store: STORE,
    total: 1,
    limit: 2,
    offset: 4,
    items: [REPOSITORY],
  });
});

Deno.test("public store routes - returns a single inventory reference", async () => {
  let observed:
    | { origin: string; storeSlug: string; referenceId: string }
    | null = null;
  setPublicStoreRouteTestDeps({
    findPublicStoreInventoryItem: async (
      _db,
      origin,
      storeSlug,
      referenceId,
    ) => {
      observed = { origin, storeSlug, referenceId };
      return REPOSITORY;
    },
  });

  const response = await createApp().fetch(
    new Request(
      "https://test.takos.jp/api/public/stores/curated/inventory/repo-ref-1",
    ),
    env(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(observed, {
    origin: "https://test.takos.jp",
    storeSlug: "curated",
    referenceId: "repo-ref-1",
  });
  assertEquals(await response.json(), { repository: REPOSITORY });
});

Deno.test("public store routes - searches repositories with q parameter", async () => {
  let observed:
    | {
      origin: string;
      storeSlug: string;
      query: string;
      limit: number;
      offset: number;
    }
    | null = null;
  setPublicStoreRouteTestDeps({
    searchPublicStoreRepositories: async (
      _db,
      origin,
      storeSlug,
      query,
      options,
    ) => {
      observed = { origin, storeSlug, query, ...options };
      return { store: STORE, total: 1, items: [REPOSITORY] };
    },
  });

  const response = await createApp().fetch(
    new Request(
      "https://test.takos.jp/api/public/stores/curated/search/repositories?q=demo&limit=5",
    ),
    env(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(observed, {
    origin: "https://test.takos.jp",
    storeSlug: "curated",
    query: "demo",
    limit: 5,
    offset: 0,
  });
  assertEquals(await response.json(), {
    store: STORE,
    total: 1,
    query: "demo",
    limit: 5,
    offset: 0,
    repositories: [REPOSITORY],
  });
});

Deno.test("public store routes - rejects search without q parameter", async () => {
  const response = await createApp().fetch(
    new Request(
      "https://test.takos.jp/api/public/stores/curated/search/repositories",
    ),
    env(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "q parameter required" });
});

Deno.test("public store routes - serves store feed", async () => {
  setPublicStoreRouteTestDeps({
    listPublicStoreFeed: async () => ({
      store: STORE,
      total: 1,
      items: [{
        id: "feed-1",
        type: "repo.push",
        published: "2026-03-03T00:00:00.000Z",
        repository: REPOSITORY,
        ref: "refs/heads/main",
        before_hash: "abc123",
        after_hash: "def456",
        commit_count: 1,
        commits: [],
      }],
    }),
  });

  const response = await createApp().fetch(
    new Request("https://test.takos.jp/api/public/stores/curated/feed"),
    env(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    store: STORE,
    total: 1,
    limit: 20,
    offset: 0,
    items: [{
      id: "feed-1",
      type: "repo.push",
      published: "2026-03-03T00:00:00.000Z",
      repository: REPOSITORY,
      ref: "refs/heads/main",
      before_hash: "abc123",
      after_hash: "def456",
      commit_count: 1,
      commits: [],
    }],
  });
});
