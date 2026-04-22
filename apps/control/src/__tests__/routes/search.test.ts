import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assert, assertEquals } from "jsr:@std/assert";
import { NotFoundError, routeAuthDeps } from "@/routes/route-auth";

function createRecordedMock<T extends (...args: any[]) => any>(impl: T) {
  const fn = ((...args: Parameters<T>) => {
    fn.calls.push({ args });
    return impl(...args);
  }) as T & { calls: Array<{ args: Parameters<T> }> };
  fn.calls = [];
  return fn;
}

const mocks = {
  searchWorkspace: createRecordedMock((..._args: any[]) => undefined) as any,
  quickSearchPaths: createRecordedMock((..._args: any[]) => undefined) as any,
  requireSpaceAccess: createRecordedMock((..._args: any[]) => undefined) as any,
  computeSHA256: createRecordedMock((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/source/search'
// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/hash'
// [Deno] vi.mock removed - manually stub imports from '@/middleware/cache'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import searchRoute from "@/routes/search";
import { searchRouteDeps } from "@/routes/search";

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

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  installAppErrorHandler(app);
  routeAuthDeps.requireSpaceAccess =
    ((...args: Parameters<typeof mocks.requireSpaceAccess>) =>
      mocks.requireSpaceAccess(...args)) as any;
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", searchRoute);
  return app;
}

const env = createMockEnv();

function resetSearchMocks() {
  mocks.searchWorkspace.calls = [];
  mocks.quickSearchPaths.calls = [];
  mocks.requireSpaceAccess.calls = [];
  mocks.computeSHA256.calls = [];
}

Deno.test("search routes - POST /api/spaces/:spaceId/search - returns search results", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  })) as any;
  mocks.computeSHA256 = createRecordedMock(async () =>
    "fakehash123456789"
  ) as any;
  mocks.searchWorkspace = createRecordedMock(async () => ({
    results: [{ path: "test.ts", score: 0.9 }],
    total: 1,
    semanticAvailable: true,
  })) as any;

  const app = createApp(createUser());
  searchRouteDeps.searchWorkspace = mocks.searchWorkspace;
  searchRouteDeps.quickSearchPaths = mocks.quickSearchPaths;
  searchRouteDeps.computeSHA256 = mocks.computeSHA256;
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test query" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("query" in json);
  assertEquals((json as any)["query"], "test query");
  assert("results" in json);
  assert("total" in json);
  assertEquals((json as any)["total"], 1);
});
Deno.test("search routes - POST /api/spaces/:spaceId/search - returns 400 for empty query", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  })) as any;
  mocks.computeSHA256 = createRecordedMock(async () =>
    "fakehash123456789"
  ) as any;
  const app = createApp(createUser());
  searchRouteDeps.searchWorkspace = mocks.searchWorkspace;
  searchRouteDeps.quickSearchPaths = mocks.quickSearchPaths;
  searchRouteDeps.computeSHA256 = mocks.computeSHA256;
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("search routes - POST /api/spaces/:spaceId/search - returns 400 for missing query", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  })) as any;
  mocks.computeSHA256 = createRecordedMock(async () =>
    "fakehash123456789"
  ) as any;
  const app = createApp(createUser());
  searchRouteDeps.searchWorkspace = mocks.searchWorkspace;
  searchRouteDeps.quickSearchPaths = mocks.quickSearchPaths;
  searchRouteDeps.computeSHA256 = mocks.computeSHA256;
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("search routes - POST /api/spaces/:spaceId/search - returns 400 for invalid JSON body", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  })) as any;
  mocks.computeSHA256 = createRecordedMock(async () =>
    "fakehash123456789"
  ) as any;
  const app = createApp(createUser());
  searchRouteDeps.searchWorkspace = mocks.searchWorkspace;
  searchRouteDeps.quickSearchPaths = mocks.quickSearchPaths;
  searchRouteDeps.computeSHA256 = mocks.computeSHA256;
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("search routes - POST /api/spaces/:spaceId/search - returns 404 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.computeSHA256 = createRecordedMock(async () =>
    "fakehash123456789"
  ) as any;

  const app = createApp(createUser());
  routeAuthDeps.requireSpaceAccess = async () => {
    throw new NotFoundError("Workspace");
  };
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-bad/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("search routes - GET /api/spaces/:spaceId/search/quick - returns quick search results", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  })) as any;
  mocks.computeSHA256 = createRecordedMock(async () =>
    "fakehash123456789"
  ) as any;
  mocks.quickSearchPaths = createRecordedMock(
    async () => [{ path: "test.ts" }],
  ) as any;

  const app = createApp(createUser());
  searchRouteDeps.searchWorkspace = mocks.searchWorkspace;
  searchRouteDeps.quickSearchPaths = mocks.quickSearchPaths;
  searchRouteDeps.computeSHA256 = mocks.computeSHA256;
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search/quick?q=test"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("results" in json);
});
Deno.test("search routes - GET /api/spaces/:spaceId/search/quick - returns empty results for query shorter than 2 chars", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  })) as any;
  mocks.quickSearchPaths = createRecordedMock(async () => []) as any;
  mocks.computeSHA256 = createRecordedMock(async () =>
    "fakehash123456789"
  ) as any;
  const app = createApp(createUser());
  searchRouteDeps.searchWorkspace = mocks.searchWorkspace;
  searchRouteDeps.quickSearchPaths = mocks.quickSearchPaths;
  searchRouteDeps.computeSHA256 = mocks.computeSHA256;
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search/quick?q=t"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { results: [] });
  assertEquals(mocks.quickSearchPaths.calls.length, 0);
});
Deno.test("search routes - GET /api/spaces/:spaceId/search/quick - returns empty results for missing query", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  })) as any;
  mocks.computeSHA256 = createRecordedMock(async () =>
    "fakehash123456789"
  ) as any;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search/quick"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { results: [] });
});
