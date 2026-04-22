import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../../test/integration/setup.ts";

import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

const mocks = {
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  listStoresForWorkspace: ((..._args: any[]) => undefined) as any,
  createStore: ((..._args: any[]) => undefined) as any,
  updateStore: ((..._args: any[]) => undefined) as any,
  deleteStore: ((..._args: any[]) => undefined) as any,
  listInventoryItems: ((..._args: any[]) => undefined) as any,
  addToInventory: ((..._args: any[]) => undefined) as any,
  removeFromInventory: ((..._args: any[]) => undefined) as any,
  findInventoryItemById: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
import workspaceStoresRoutes from "@/routes/spaces/stores";
import { spacesStoresRouteDeps } from "@/routes/spaces/stores";

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

function createApp(
  user: User,
): Hono<{ Bindings: Env; Variables: { user: User } }> {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api/spaces", workspaceStoresRoutes);
  return app;
}

Deno.test("workspace stores routes - lists default and custom stores for a workspace", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = (async () => ({
    space: { id: "ws-1" },
    membership: { role: "owner" },
  })) as any;
  mocks.listStoresForWorkspace = (async () => [
    {
      accountId: "ws-1",
      accountSlug: "alice",
      slug: "alice",
      name: "Alice",
      summary: "Default store",
      iconUrl: null,
      isDefault: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
    {
      accountId: "ws-1",
      accountSlug: "alice",
      slug: "oss",
      name: "OSS Catalog",
      summary: "Open source picks",
      iconUrl: "https://cdn.test/oss.png",
      isDefault: false,
      createdAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    },
  ]) as any;
  spacesStoresRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  spacesStoresRouteDeps.listStoresForWorkspace = mocks.listStoresForWorkspace;

  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/spaces/ws-1/stores"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertEquals(await response.json(), {
    stores: [
      {
        slug: "alice",
        name: "Alice",
        summary: "Default store",
        icon_url: null,
        is_default: true,
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
      },
      {
        slug: "oss",
        name: "OSS Catalog",
        summary: "Open source picks",
        icon_url: "https://cdn.test/oss.png",
        is_default: false,
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
      },
    ],
  });
});
Deno.test("workspace stores routes - creates a custom store for a workspace", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = (async () => ({
    space: { id: "ws-1" },
    membership: { role: "owner" },
  })) as any;
  mocks.createStore = spy(async () => ({
    accountId: "ws-1",
    accountSlug: "alice",
    slug: "oss",
    name: "OSS Catalog",
    summary: "Open source picks",
    iconUrl: null,
    isDefault: false,
    createdAt: "2026-03-02T00:00:00.000Z",
    updatedAt: "2026-03-02T00:00:00.000Z",
  })) as any;
  spacesStoresRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  spacesStoresRouteDeps.createStore = mocks.createStore;

  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/spaces/ws-1/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "oss",
        name: "OSS Catalog",
        summary: "Open source picks",
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 201);
  assertSpyCalls(mocks.createStore, 1);
  assert(mocks.createStore.calls[0].args[0] != null);
  assertEquals(mocks.createStore.calls[0].args.slice(1), ["ws-1", {
    slug: "oss",
    name: "OSS Catalog",
    summary: "Open source picks",
    iconUrl: undefined,
  }]);
});
Deno.test("workspace stores routes - updates a custom store for a workspace", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = (async () => ({
    space: { id: "ws-1" },
    membership: { role: "owner" },
  })) as any;
  mocks.updateStore = spy(async () => ({
    accountId: "ws-1",
    accountSlug: "alice",
    slug: "oss",
    name: "OSS Catalog",
    summary: "Updated summary",
    iconUrl: null,
    isDefault: false,
    createdAt: "2026-03-02T00:00:00.000Z",
    updatedAt: "2026-03-03T00:00:00.000Z",
  })) as any;
  spacesStoresRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  spacesStoresRouteDeps.updateStore = mocks.updateStore;

  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/spaces/ws-1/stores/oss", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: "Updated summary",
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertSpyCalls(mocks.updateStore, 1);
  assert(mocks.updateStore.calls[0].args[0] != null);
  assertEquals(mocks.updateStore.calls[0].args.slice(1), [
    "ws-1",
    "oss",
    {
      name: undefined,
      summary: "Updated summary",
      iconUrl: undefined,
    },
  ]);
});
Deno.test("workspace stores routes - deletes a custom store for a workspace", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = (async () => ({
    space: { id: "ws-1" },
    membership: { role: "owner" },
  })) as any;
  mocks.deleteStore = spy(async () => true) as any;
  spacesStoresRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  spacesStoresRouteDeps.deleteStore = mocks.deleteStore;

  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/spaces/ws-1/stores/oss", {
      method: "DELETE",
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertEquals(await response.json(), { success: true });
  assertSpyCalls(mocks.deleteStore, 1);
  assert(mocks.deleteStore.calls[0].args[0] != null);
  assertEquals(mocks.deleteStore.calls[0].args.slice(1), [
    "ws-1",
    "oss",
  ]);
});

Deno.test("workspace stores routes - includes package icon for inventory items", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = (async () => ({
    space: { id: "ws-1" },
    membership: { role: "owner" },
  })) as any;
  mocks.listInventoryItems = spy(async () => ({
    total: 1,
    items: [{
      id: "item-1",
      storeSlug: "oss",
      accountId: "ws-1",
      repositoryUrl: "https://takos.test/@alice/docs",
      repoActorUrl: "https://takos.test/@alice/docs",
      repoName: "docs",
      repoSummary: "Docs app",
      repoOwnerSlug: "alice",
      repoCloneUrl: "https://takos.test/git/alice/docs.git",
      repoBrowseUrl: "https://takos.test/@alice/docs",
      repoDefaultBranch: "main",
      repoDefaultBranchHash: "abc123",
      packageIcon: "/icons/docs.svg",
      localRepoId: "repo-1",
      activityType: "Add",
      isActive: true,
      createdAt: "2026-03-04T00:00:00.000Z",
    }],
  })) as any;
  spacesStoresRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  spacesStoresRouteDeps.listInventoryItems = mocks.listInventoryItems;

  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/spaces/ws-1/stores/oss/inventory"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertSpyCalls(mocks.listInventoryItems, 1);
  assertEquals(mocks.listInventoryItems.calls[0].args.slice(1), [
    "ws-1",
    "oss",
    { limit: 20, offset: 0 },
  ]);
  await assertEquals(await response.json(), {
    total: 1,
    items: [{
      id: "item-1",
      repository_url: "https://takos.test/@alice/docs",
      label: "docs",
      clone_url: "https://takos.test/git/alice/docs.git",
      browse_url: "https://takos.test/@alice/docs",
      default_branch: "main",
      default_branch_hash: "abc123",
      package_icon: "/icons/docs.svg",
      repo_name: "docs",
      repo_summary: "Docs app",
      repo_owner_slug: "alice",
      local_repo_id: "repo-1",
      created_at: "2026-03-04T00:00:00.000Z",
    }],
  });
});
