import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assert, assertEquals } from "@std/assert";
import { asyncNoopDep, noopDep } from "@test/dep-stubs";

type LooseAsyncFn = (...args: unknown[]) => Promise<unknown>;
type LooseFn = (...args: unknown[]) => unknown;

const mocks: {
  getUserByUsername: LooseAsyncFn;
  getUserStats: LooseAsyncFn;
  isFollowing: LooseAsyncFn;
  batchStarCheck: LooseAsyncFn;
  getDb: LooseFn;
} = {
  getUserByUsername: asyncNoopDep("profilesViewRouteDeps.getUserByUsername"),
  getUserStats: asyncNoopDep("profilesViewRouteDeps.getUserStats"),
  isFollowing: asyncNoopDep("profilesViewRouteDeps.isFollowing"),
  batchStarCheck: asyncNoopDep("profilesViewRouteDeps.batchStarCheck"),
  getDb: noopDep("profilesViewRouteDeps.getDb"),
};

// [Deno] vi.mock removed - manually stub imports from '@/routes/profiles/shared'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/db/schema'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
import profiles from "@/routes/profiles/index";
import { profilesViewRouteDeps } from "@/routes/profiles/view.ts";

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

function bindMock<K extends keyof typeof profilesViewRouteDeps>(
  mockKey: keyof typeof mocks,
): typeof profilesViewRouteDeps[K] {
  return ((...args: unknown[]) => {
    type AnyFn = (...a: unknown[]) => unknown;
    return (mocks[mockKey] as AnyFn)(...args);
  }) as typeof profilesViewRouteDeps[K];
}

function applyMockBindings() {
  profilesViewRouteDeps.getUserByUsername = bindMock<"getUserByUsername">(
    "getUserByUsername",
  );
  profilesViewRouteDeps.getUserStats = bindMock<"getUserStats">("getUserStats");
  profilesViewRouteDeps.isFollowing = bindMock<"isFollowing">("isFollowing");
  profilesViewRouteDeps.batchStarCheck = bindMock<"batchStarCheck">(
    "batchStarCheck",
  );
  profilesViewRouteDeps.getDb = bindMock<"getDb">("getDb");
}

function createApp(user?: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user?: User } }>();
  installAppErrorHandler(app);
  applyMockBindings();
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.route("/", profiles);
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
    all: async () => results,
    get: async () => results[0] ?? null,
  };
  mocks.getDb = () => chain;
  return chain;
}

const env = createMockEnv();

Deno.test("profiles view routes - GET /:username - returns profile with repos for existing user", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getUserByUsername = async () => ({
    id: "u-target",
    username: "targetuser",
    name: "Target User",
    bio: "A bio",
    picture: null,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  mocks.getDb = () => mockDbChain([]);
  mocks.getUserStats = async () => ({
    public_repo_count: 3,
    followers_count: 10,
    following_count: 5,
  });
  mocks.isFollowing = async () => false;
  mocks.batchStarCheck = async () => new Set();
  mockDbChain([]);
  mocks.getDb = () => mockDbChain([]);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/targetuser"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as {
    profile: { username: string; is_self: boolean };
    recent_repos: unknown[];
  };
  assertEquals(json.profile.username, "targetuser");
  assertEquals(json.profile.is_self, false);
});
Deno.test("profiles view routes - GET /:username - returns 404 for non-existent user", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getUserByUsername = async () => null;

  const app = createApp(createUser());
  mocks.getDb = () => mockDbChain([]);
  const res = await app.fetch(
    new Request("http://localhost/nonexistent"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("profiles view routes - GET /:username - correctly identifies self view", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getUserByUsername = async () => ({
    id: "user-1", // same as createUser
    username: "user1",
    name: "User One",
    bio: null,
    picture: null,
    created_at: "2026-03-01T00:00:00.000Z",
  });
  mocks.getDb = () => mockDbChain([]);
  mocks.getUserStats = async () => ({
    public_repo_count: 0,
    followers_count: 0,
    following_count: 0,
  });
  mocks.isFollowing = async () => false;
  mocks.batchStarCheck = async () => new Set();
  mockDbChain([]);
  mocks.getDb = () => mockDbChain([]);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/user1"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as { profile: { is_self: boolean } };
  assertEquals(json.profile.is_self, true);
});
Deno.test("profiles view routes - GET /:username - works for anonymous users", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getUserByUsername = async () => ({
    id: "u-target",
    username: "targetuser",
    name: "Target",
    bio: null,
    picture: null,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  mocks.getDb = () => mockDbChain([]);
  mocks.getUserStats = async () => ({
    public_repo_count: 0,
    followers_count: 0,
    following_count: 0,
  });
  mocks.isFollowing = async () => false;
  mocks.batchStarCheck = async () => new Set();
  mockDbChain([]);
  mocks.getDb = () => mockDbChain([]);

  const app = createApp(); // no user
  const res = await app.fetch(
    new Request("http://localhost/targetuser"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as { profile: { is_self: boolean } };
  assertEquals(json.profile.is_self, false);
});

Deno.test("profiles view routes - GET /:username/repos - returns 404 for non-existent user", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getUserByUsername = async () => null;

  const app = createApp();
  mocks.getDb = () => mockDbChain([]);
  const res = await app.fetch(
    new Request("http://localhost/nonexistent/repos"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("profiles view routes - GET /:username/repos - returns repos with pagination metadata", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getUserByUsername = async () => ({
    id: "u-target",
    username: "targetuser",
    name: "Target",
    bio: null,
    picture: null,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  mocks.getDb = () => {
    const chain = mockDbChain([]);
    chain.get = async () => ({ count: 0 });
    return chain;
  };
  mocks.batchStarCheck = async () => new Set();

  const chain = mockDbChain([]);
  chain.get = async () => ({ count: 0 });

  const app = createApp();
  mocks.getDb = () => chain;
  const res = await app.fetch(
    new Request("http://localhost/targetuser/repos"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as {
    repos: unknown[];
    total: number;
    has_more: boolean;
  };
  assert("repos" in json);
  assert("total" in json);
  assert("has_more" in json);
});
