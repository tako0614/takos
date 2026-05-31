import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assert, assertEquals } from "@std/assert";
import { NotFoundError, routeAuthDeps } from "@/routes/route-auth";

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

type RecordedCalls = { calls: Array<{ args: unknown[] }> };
type LooseAsyncFn =
  & ((...args: unknown[]) => Promise<unknown>)
  & RecordedCalls;

const mocks: {
  searchWorkspace: LooseAsyncFn;
  quickSearchPaths: LooseAsyncFn;
  requireSpaceAccess: LooseAsyncFn;
  computeSHA256: LooseAsyncFn;
} = {
  searchWorkspace: createRecordedMock(async () => undefined),
  quickSearchPaths: createRecordedMock(async () => undefined),
  requireSpaceAccess: createRecordedMock(async () => undefined),
  computeSHA256: createRecordedMock(async () => undefined),
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

function bindSearchMock<K extends keyof typeof searchRouteDeps>(
  mockKey: keyof typeof mocks,
): typeof searchRouteDeps[K] {
  return ((...args: unknown[]) => {
    type AnyFn = (...a: unknown[]) => unknown;
    return (mocks[mockKey] as AnyFn)(...args);
  }) as typeof searchRouteDeps[K];
}

function applySearchMockBindings() {
  searchRouteDeps.searchWorkspace = bindSearchMock<"searchWorkspace">(
    "searchWorkspace",
  );
  searchRouteDeps.quickSearchPaths = bindSearchMock<"quickSearchPaths">(
    "quickSearchPaths",
  );
  searchRouteDeps.computeSHA256 = bindSearchMock<"computeSHA256">(
    "computeSHA256",
  );
}

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  installAppErrorHandler(app);
  routeAuthDeps.requireSpaceAccess = ((...args: unknown[]) => {
    type AnyFn = (...a: unknown[]) => unknown;
    return (mocks.requireSpaceAccess as AnyFn)(...args);
  }) as typeof routeAuthDeps.requireSpaceAccess;
  applySearchMockBindings();
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
  }));
  mocks.computeSHA256 = createRecordedMock(async () => "fakehash123456789");
  mocks.searchWorkspace = createRecordedMock(async () => ({
    results: [{ path: "test.ts", score: 0.9 }],
    total: 1,
    semanticAvailable: true,
  }));

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test query" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("query" in json);
  assertEquals(json["query"], "test query");
  assert("results" in json);
  assert("total" in json);
  assertEquals(json["total"], 1);
});
Deno.test("search routes - POST /api/spaces/:spaceId/search - returns 400 for empty query", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  }));
  mocks.computeSHA256 = createRecordedMock(async () => "fakehash123456789");
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("search routes - POST /api/spaces/:spaceId/search - returns 400 for missing query", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  }));
  mocks.computeSHA256 = createRecordedMock(async () => "fakehash123456789");
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("search routes - POST /api/spaces/:spaceId/search - returns 400 for invalid JSON body", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  }));
  mocks.computeSHA256 = createRecordedMock(async () => "fakehash123456789");
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("search routes - POST /api/spaces/:spaceId/search - returns 404 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.computeSHA256 = createRecordedMock(async () => "fakehash123456789");

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
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("search routes - GET /api/spaces/:spaceId/search/quick - returns quick search results", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetSearchMocks();
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
  }));
  mocks.computeSHA256 = createRecordedMock(async () => "fakehash123456789");
  mocks.quickSearchPaths = createRecordedMock(
    async () => [{ path: "test.ts" }],
  );

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search/quick?q=test"),
    env,
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
  }));
  mocks.quickSearchPaths = createRecordedMock(async () => []);
  mocks.computeSHA256 = createRecordedMock(async () => "fakehash123456789");
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search/quick?q=t"),
    env,
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
  }));
  mocks.computeSHA256 = createRecordedMock(async () => "fakehash123456789");
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/search/quick"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { results: [] });
});
