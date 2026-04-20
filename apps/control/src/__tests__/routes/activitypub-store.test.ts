import { Hono } from "hono";
import type { Env } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import {
  assertEquals,
  assertObjectMatch,
  assertStringIncludes,
} from "jsr:@std/assert";

const mocks = {
  findStoreBySlug: ((..._args: any[]) => undefined) as any,
  findCanonicalRepo: ((..._args: any[]) => undefined) as any,
  findCanonicalRepoIncludingPrivate: ((..._args: any[]) => undefined) as any,
  listStoreRepositories: ((..._args: any[]) => undefined) as any,
  listStoresForRepo: ((..._args: any[]) => undefined) as any,
  findStoreRepository: ((..._args: any[]) => undefined) as any,
  searchStoreRepositories: ((..._args: any[]) => undefined) as any,
  listPushActivities: ((..._args: any[]) => undefined) as any,
  listPushActivitiesForRepoIds: ((..._args: any[]) => undefined) as any,
  hasExplicitInventory: ((..._args: any[]) => undefined) as any,
  listInventoryActivities: ((..._args: any[]) => undefined) as any,
  listInventoryItems: ((..._args: any[]) => undefined) as any,
  addFollower: ((..._args: any[]) => undefined) as any,
  removeFollower: ((..._args: any[]) => undefined) as any,
  listFollowers: ((..._args: any[]) => undefined) as any,
  countFollowers: ((..._args: any[]) => undefined) as any,
  checkGrant: ((..._args: any[]) => undefined) as any,
  cache: {
    match: ((..._args: any[]) => undefined) as any,
    put: ((..._args: any[]) => undefined) as any,
    delete: ((..._args: any[]) => undefined) as any,
  },
};

let mockCacheStorage = {
  default: mocks.cache as unknown as Cache,
} as CacheStorage;
Object.defineProperty(globalThis, "caches", {
  configurable: true,
  enumerable: true,
  get: () => mockCacheStorage,
  set: (value) => {
    mockCacheStorage = value as CacheStorage;
  },
});

// [Deno] vi.mock removed - manually stub imports from '@/routes/activitypub-store/activitypub-queries'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/activitypub/push-activities'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/activitypub/store-inventory'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/activitypub/grants'
// [Deno] vi.mock removed - manually stub imports from '@/middleware/http-signature'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/activitypub/followers'
import activitypubStore, {
  setActivitypubStoreTestDeps,
} from "@/routes/activitypub-store/routes";

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  app.route("/", activitypubStore);
  return app;
}

function applyActivitypubStoreMocks() {
  setActivitypubStoreTestDeps({
    findStoreBySlug: (...args: Parameters<typeof mocks.findStoreBySlug>) =>
      mocks.findStoreBySlug(...args),
    findCanonicalRepo: (...args: Parameters<typeof mocks.findCanonicalRepo>) =>
      mocks.findCanonicalRepo(...args),
    findCanonicalRepoIncludingPrivate: (
      ...args: Parameters<typeof mocks.findCanonicalRepoIncludingPrivate>
    ) => mocks.findCanonicalRepoIncludingPrivate(...args),
    listStoreRepositories: (
      ...args: Parameters<typeof mocks.listStoreRepositories>
    ) => mocks.listStoreRepositories(...args),
    listStoresForRepo: (...args: Parameters<typeof mocks.listStoresForRepo>) =>
      mocks.listStoresForRepo(...args),
    searchStoreRepositories: (
      ...args: Parameters<typeof mocks.searchStoreRepositories>
    ) => mocks.searchStoreRepositories(...args),
    listPushActivities: (
      ...args: Parameters<typeof mocks.listPushActivities>
    ) => mocks.listPushActivities(...args),
    listPushActivitiesForRepoIds: (
      ...args: Parameters<typeof mocks.listPushActivitiesForRepoIds>
    ) => mocks.listPushActivitiesForRepoIds(...args),
    hasExplicitInventory: (
      ...args: Parameters<typeof mocks.hasExplicitInventory>
    ) => mocks.hasExplicitInventory(...args),
    listInventoryActivities: (
      ...args: Parameters<typeof mocks.listInventoryActivities>
    ) => mocks.listInventoryActivities(...args),
    listInventoryItems: (
      ...args: Parameters<typeof mocks.listInventoryItems>
    ) => mocks.listInventoryItems(...args),
    addFollower: (...args: Parameters<typeof mocks.addFollower>) =>
      mocks.addFollower(...args),
    removeFollower: (...args: Parameters<typeof mocks.removeFollower>) =>
      mocks.removeFollower(...args),
    listFollowers: (...args: Parameters<typeof mocks.listFollowers>) =>
      mocks.listFollowers(...args),
    checkGrant: (...args: Parameters<typeof mocks.checkGrant>) =>
      mocks.checkGrant(...args),
    verifyHttpSignature: async (request: Request, _body?: Uint8Array) => {
      // Test mock: extract actor from a header so each test can wire up
      // signature verification without re-parsing the request body. If the
      // test supplies `x-test-signature-verified: false`, pretend the
      // signature failed so error branches can be exercised.
      const actorUrl = request.headers.get("x-test-signature-actor") ?? "";
      const verified =
        request.headers.get("x-test-signature-verified") !== "false";
      return {
        verified,
        actorUrl,
        keyId: "",
      } as any;
    },
  });
}

applyActivitypubStoreMocks();

const STORE_RECORD = {
  accountId: "acct-1",
  accountSlug: "alice",
  slug: "alice",
  name: "Alice",
  description: null,
  picture: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  publicRepoCount: 2,
  isDefault: true,
};

const REPO_RECORD = {
  id: "repo-1",
  ownerId: "acct-1",
  ownerSlug: "alice",
  ownerName: "Alice",
  name: "demo",
  description: "Demo repo",
  visibility: "public",
  defaultBranch: "main",
  defaultBranchHash: "abc123def456",
  stars: 3,
  forks: 1,
  gitEnabled: true,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

Deno.test("activitypub store routes - resolves store actors via WebFinger", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug =
    (async () => ({ ...STORE_RECORD, description: "Catalog" })) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request(
      "https://test.takos.jp/.well-known/webfinger?resource=acct:alice@test.takos.jp",
    ),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertStringIncludes(
    response.headers.get("Content-Type") ?? "",
    "application/jrd+json",
  );
  await assertObjectMatch(await response.json(), {
    subject: "acct:alice@test.takos.jp",
    aliases: ["https://test.takos.jp/ap/stores/alice"],
  });
});
Deno.test("activitypub store routes - resolves canonical repo actors via WebFinger URL", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findCanonicalRepo = (async () => REPO_RECORD) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request(
      "https://test.takos.jp/.well-known/webfinger?resource=https://test.takos.jp/ap/repos/alice/demo",
    ),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertObjectMatch(await response.json(), {
    aliases: ["https://test.takos.jp/ap/repos/alice/demo"],
    links: [{
      rel: "self",
      type: "application/activity+json",
      href: "https://test.takos.jp/ap/repos/alice/demo",
    }],
  });
});
Deno.test("activitypub store routes - serves store actors as Service+Store with inventory", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug = (async () => ({
    ...STORE_RECORD,
    picture: "https://cdn.test/alice.png",
  })) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertStringIncludes(
    response.headers.get("Content-Type") ?? "",
    "application/activity+json",
  );

  await assertObjectMatch(await response.json(), {
    id: "https://test.takos.jp/ap/stores/alice",
    type: ["Service", "Store"],
    preferredUsername: "alice",
    name: "Alice",
    inbox: "https://test.takos.jp/ap/stores/alice/inbox",
    outbox: "https://test.takos.jp/ap/stores/alice/outbox",
    followers: "https://test.takos.jp/ap/stores/alice/followers",
    inventory: "https://test.takos.jp/ap/stores/alice/inventory",
    search: "https://test.takos.jp/ap/stores/alice/search",
    repositorySearch:
      "https://test.takos.jp/ap/stores/alice/search/repositories",
  });
});
Deno.test("activitypub store routes - accepts Follow on store inbox and returns Accept", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug = (async () => STORE_RECORD) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        date: new Date().toUTCString(),
        signature: "test-signature",
        "x-test-signature-actor": "https://remote.example/ap/users/bob",
      },
      body: JSON.stringify({
        id: `https://remote.example/activities/${crypto.randomUUID()}`,
        type: "Follow",
        actor: "https://remote.example/ap/users/bob",
        object: "https://test.takos.jp/ap/stores/alice",
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertObjectMatch(await response.json(), {
    type: "Accept",
    actor: "https://test.takos.jp/ap/stores/alice",
    object: {
      type: "Follow",
      actor: "https://remote.example/ap/users/bob",
    },
  });
});
Deno.test("activitypub store routes - rejects unsupported activity types on inbox", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug = (async () => STORE_RECORD) as any;

  const app = createApp();
  // `Create` at the top level is not a type the store inbox can act on
  // (Like / Announce / Update are ack-acknowledged, Follow / Undo are
  // persisted). Everything else still falls through to 422.
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        date: new Date().toUTCString(),
        signature: "test-signature",
        "x-test-signature-actor": "https://remote.example/ap/users/bob",
      },
      body: JSON.stringify({
        id: `https://remote.example/activities/${crypto.randomUUID()}`,
        type: "Block",
        actor: "https://remote.example/ap/users/bob",
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 422);
});
Deno.test("activitypub store routes - serves inventory collection with ForgeFed Repository actors", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug =
    (async () => ({ ...STORE_RECORD, publicRepoCount: 1 })) as any;
  mocks.listStoreRepositories = (async () => ({
    total: 1,
    items: [REPO_RECORD],
  })) as any;

  const app = createApp();
  const env = createMockEnv() as unknown as Env;

  const summaryResponse = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/inventory"),
    env,
    {} as ExecutionContext,
  );
  assertEquals(summaryResponse.status, 200);
  await assertObjectMatch(await summaryResponse.json(), {
    type: "OrderedCollection",
    totalItems: 1,
    first: "https://test.takos.jp/ap/stores/alice/inventory?page=1",
  });

  const pageResponse = await app.fetch(
    new Request(
      "https://test.takos.jp/ap/stores/alice/inventory?page=1&expand=object",
    ),
    env,
    {} as ExecutionContext,
  );
  assertEquals(pageResponse.status, 200);
  await assertObjectMatch(await pageResponse.json(), {
    type: "OrderedCollectionPage",
    orderedItems: [{
      id: "https://test.takos.jp/ap/repos/alice/demo",
      type: "Repository",
      name: "demo",
      cloneUri: ["https://test.takos.jp/git/alice/demo.git"],
      defaultBranchRef: "refs/heads/main",
      inbox: "https://test.takos.jp/ap/repos/alice/demo/inbox",
      outbox: "https://test.takos.jp/ap/repos/alice/demo/outbox",
      stores: "https://test.takos.jp/ap/repos/alice/demo/stores",
    }],
  });
});
Deno.test("activitypub store routes - search service uses plain field names", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug = (async () => STORE_RECORD) as any;
  mocks.searchStoreRepositories = (async () => ({
    total: 1,
    items: [REPO_RECORD],
  })) as any;

  const app = createApp();
  const env = createMockEnv() as unknown as Env;

  const serviceResponse = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/search"),
    env,
    {} as ExecutionContext,
  );
  assertEquals(serviceResponse.status, 200);
  await assertObjectMatch(await serviceResponse.json(), {
    id: "https://test.takos.jp/ap/stores/alice/search",
    type: "Service",
    repositorySearch:
      "https://test.takos.jp/ap/stores/alice/search/repositories",
  });

  const pageResponse = await app.fetch(
    new Request(
      "https://test.takos.jp/ap/stores/alice/search/repositories?q=demo&page=1&expand=object",
    ),
    env,
    {} as ExecutionContext,
  );
  assertEquals(pageResponse.status, 200);
  await assertObjectMatch(await pageResponse.json(), {
    type: "OrderedCollectionPage",
    orderedItems: [{
      id: "https://test.takos.jp/ap/repos/alice/demo",
      type: "Repository",
    }],
  });
});
Deno.test("activitypub store routes - returns canonical repository actor at /ap/repos/:owner/:repo", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findCanonicalRepo = (async () => ({
    ...REPO_RECORD,
    updatedAt: "2026-03-02T00:00:00.000Z",
  })) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/repos/alice/demo"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertObjectMatch(await response.json(), {
    id: "https://test.takos.jp/ap/repos/alice/demo",
    type: "Repository",
    name: "demo",
    inbox: "https://test.takos.jp/ap/repos/alice/demo/inbox",
    outbox: "https://test.takos.jp/ap/repos/alice/demo/outbox",
    followers: "https://test.takos.jp/ap/repos/alice/demo/followers",
    cloneUri: ["https://test.takos.jp/git/alice/demo.git"],
    stores: "https://test.takos.jp/ap/repos/alice/demo/stores",
    defaultBranchRef: "refs/heads/main",
  });
});
Deno.test("activitypub store routes - returns stores collection for a canonical repo", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findCanonicalRepo = (async () => REPO_RECORD) as any;
  mocks.listStoresForRepo = (async () => [STORE_RECORD]) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/repos/alice/demo/stores?page=1"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertObjectMatch(await response.json(), {
    type: "OrderedCollectionPage",
    orderedItems: ["https://test.takos.jp/ap/stores/alice"],
  });
});
Deno.test("activitypub store routes - builds outbox entries with ForgeFed Repository objects", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug =
    (async () => ({ ...STORE_RECORD, publicRepoCount: 1 })) as any;
  mocks.listStoreRepositories = (async () => ({
    total: 1,
    items: [{
      ...REPO_RECORD,
      updatedAt: "2026-03-02T00:00:00.000Z",
    }],
  })) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/outbox?page=1"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertObjectMatch(await response.json(), {
    type: "OrderedCollectionPage",
    orderedItems: [{
      type: "Update",
      actor: "https://test.takos.jp/ap/stores/alice",
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      object: {
        id: "https://test.takos.jp/ap/repos/alice/demo",
        type: "Repository",
      },
    }],
  });
});
Deno.test("activitypub store routes - does not serve legacy /repositories alias", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/repositories?page=1"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 404);
});
Deno.test("activitypub store routes - does not serve legacy /ns/takos-git alias", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ns/takos-git"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 404);
});
Deno.test("activitypub store routes - serves takos namespace context at /ns/takos", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ns/takos"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertStringIncludes(
    response.headers.get("Content-Type") ?? "",
    "application/ld+json",
  );
  const body = await response.json() as Record<string, unknown>;
  const ctx = body["@context"] as Record<string, unknown>;
  assertEquals(ctx.takos, "https://takos.jp/ns#");
  assertEquals(ctx.Store, "takos:Store");
  assertEquals(ctx.inventory, { "@id": "takos:inventory", "@type": "@id" });
  assertEquals(ctx.beforeHash, "takos:beforeHash");
  assertEquals(ctx.afterHash, "takos:afterHash");
});
Deno.test("activitypub store routes - includes pushUri and defaultBranchHash in repo actor", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findCanonicalRepo = (async () => REPO_RECORD) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/repos/alice/demo"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertObjectMatch(await response.json(), {
    pushUri: ["https://test.takos.jp/git/alice/demo.git"],
    defaultBranchHash: "abc123def456",
  });
});
Deno.test("activitypub store routes - serves Add/Remove activities in store outbox (explicit mode)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug =
    (async () => ({ ...STORE_RECORD, publicRepoCount: 1 })) as any;
  mocks.hasExplicitInventory = (async () => true) as any;
  mocks.listInventoryActivities = (async () => ({
    total: 2,
    items: [
      {
        id: "inv-2",
        storeSlug: "alice",
        accountId: "acct-1",
        repoActorUrl: "https://remote.example/ap/repos/bob/tool",
        activityType: "Add",
        isActive: true,
        createdAt: "2026-03-02T00:00:00.000Z",
      },
      {
        id: "inv-1",
        storeSlug: "alice",
        accountId: "acct-1",
        repoActorUrl: "https://test.takos.jp/ap/repos/alice/demo",
        activityType: "Add",
        isActive: true,
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ],
  })) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/outbox?page=1"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertObjectMatch(await response.json(), {
    type: "OrderedCollectionPage",
    orderedItems: [
      {
        type: "Add",
        actor: "https://test.takos.jp/ap/stores/alice",
        object: "https://remote.example/ap/repos/bob/tool",
        target: "https://test.takos.jp/ap/stores/alice/inventory",
      },
      {
        type: "Add",
        actor: "https://test.takos.jp/ap/stores/alice",
        object: "https://test.takos.jp/ap/repos/alice/demo",
        target: "https://test.takos.jp/ap/stores/alice/inventory",
      },
    ],
  });
});

Deno.test("activitypub store routes - paginates explicit store outbox after merging inventory and announces", async () => {
  resetInboxMocks();
  mocks.findStoreBySlug =
    (async () => ({ ...STORE_RECORD, publicRepoCount: 1 })) as any;
  mocks.hasExplicitInventory = (async () => true) as any;
  mocks.listInventoryActivities = (async (
    _db: unknown,
    _accountId: string,
    _storeSlug: string,
    options: { limit: number; offset: number },
  ) => {
    assertEquals(options, { limit: 2, offset: 0 });
    return {
      total: 2,
      items: [
        {
          id: "inv-2",
          storeSlug: "alice",
          accountId: "acct-1",
          repoActorUrl: "https://remote.example/ap/repos/bob/newer",
          activityType: "Add",
          isActive: true,
          createdAt: "2026-03-03T00:00:00.000Z",
        },
        {
          id: "inv-1",
          storeSlug: "alice",
          accountId: "acct-1",
          repoActorUrl: "https://remote.example/ap/repos/bob/older",
          activityType: "Add",
          isActive: true,
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    };
  }) as any;
  mocks.listInventoryItems = (async () => ({
    total: 1,
    items: [{
      localRepoId: "repo-1",
      repoActorUrl: "https://test.takos.jp/ap/repos/alice/demo",
    }],
  })) as any;
  mocks.listPushActivitiesForRepoIds = (async (
    _db: unknown,
    _repoIds: string[],
    options: { limit: number; offset: number },
  ) => {
    assertEquals(options, { limit: 2, offset: 0 });
    return {
      total: 1,
      items: [{
        id: "push-1",
        repoId: "repo-1",
        accountId: "acct-1",
        ref: "refs/heads/main",
        beforeSha: "aaaa000",
        afterSha: "bbbb111",
        pusherActorUrl: null,
        pusherName: "Alice",
        commitCount: 0,
        commits: [],
        createdAt: "2026-03-02T00:00:00.000Z",
      }],
    };
  }) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/outbox?page=2&limit=1"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertObjectMatch(await response.json(), {
    type: "OrderedCollectionPage",
    totalItems: 3,
    orderedItems: [{
      type: "Announce",
      object: {
        type: "Push",
        target: "refs/heads/main",
        afterHash: "bbbb111",
      },
    }],
  });
});
/**
 * Helper: reset mocks to safe defaults for the inbox / outbox tests that
 * follow. Closely mirrors the inline stub block each existing test uses,
 * but consolidated so new tests can opt in with one call.
 */
function resetInboxMocks(): void {
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivities = (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
}

Deno.test("activitypub store routes - serves Push activities with commit metadata in repo outbox", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Default to auto-list mode
  mocks.hasExplicitInventory = (async () => false) as any;
  mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
  mocks.listPushActivitiesForRepoIds =
    (async () => ({ total: 0, items: [] })) as any;
  mocks.checkGrant = (async () => false) as any;
  mocks.addFollower = (async () => ({
    id: "f1",
    targetActorUrl: "",
    followerActorUrl: "",
    createdAt: "",
  })) as any;
  mocks.removeFollower = (async () => true) as any;
  mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: mocks.cache as unknown as Cache,
  } as CacheStorage;
  mocks.cache.match = (async () => undefined) as any;
  mocks.cache.put = (async () => undefined) as any;
  mocks.cache.delete = (async () => true) as any;
  mocks.findCanonicalRepo = (async () => REPO_RECORD) as any;
  mocks.listPushActivities = (async () => ({
    total: 1,
    items: [{
      id: "push-1",
      repoId: "repo-1",
      accountId: "acct-1",
      ref: "refs/heads/main",
      beforeSha: "aaaa000",
      afterSha: "bbbb111",
      pusherActorUrl: null,
      pusherName: "Alice",
      commitCount: 1,
      commits: [{
        hash: "bbbb111",
        message: "feat: add division",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committed: "2026-03-02T00:00:00.000Z",
      }],
      createdAt: "2026-03-02T00:00:00.000Z",
    }],
  })) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/repos/alice/demo/outbox?page=1"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assertObjectMatch(body, {
    type: "OrderedCollectionPage",
    orderedItems: [{
      type: "Push",
      actor: "https://test.takos.jp/ap/repos/alice/demo",
      target: "refs/heads/main",
      beforeHash: "aaaa000",
      afterHash: "bbbb111",
      object: {
        type: "OrderedCollection",
        totalItems: 1,
        orderedItems: [{
          type: "Commit",
          hash: "bbbb111",
          message: "feat: add division",
          attributedTo: { name: "Alice", email: "alice@example.com" },
        }],
      },
    }],
  });
});

// ---------------------------------------------------------------------------
// Round 11 ActivityPub findings — Digest, Reject, outbox totals, Update evict
// ---------------------------------------------------------------------------

import {
  _resetActorKeyCacheForTests,
  evictActorKeyByActorUrl,
  HttpSignatureError,
  verifyHttpSignature,
} from "@/middleware/http-signature";
import { buildRejectActivity } from "../../../../../packages/control/src/server/routes/activitypub-store/activity-builders.ts";

Deno.test("http-signature - rejects request when Digest header does not match body", async () => {
  _resetActorKeyCacheForTests();
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", publicKey));
  let binary = "";
  for (const b of spki) binary += String.fromCharCode(b);
  const pem = `-----BEGIN PUBLIC KEY-----\n${
    btoa(binary).match(/.{1,64}/g)!.join("\n")
  }\n-----END PUBLIC KEY-----\n`;

  // Use a non-blocked domain (`.example` is in the SSRF blocklist). The
  // host never actually receives traffic because we stub `globalThis.fetch`
  // below.
  const actorUrl = "https://digest-test.remote.takos.jp/ap/users/alice";
  const keyId = `${actorUrl}#main-key`;

  // `apFetch` internally calls global `fetch`. Monkey-patch the global so
  // the verifier's actor-document lookup resolves to our in-memory PEM
  // without any network I/O.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: Request | URL | string,
    _init?: RequestInit,
  ) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    if (url === actorUrl) {
      return new Response(
        JSON.stringify({
          id: actorUrl,
          publicKey: { id: keyId, owner: actorUrl, publicKeyPem: pem },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/activity+json" },
        },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const body = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
    const bodyAb = new ArrayBuffer(body.byteLength);
    new Uint8Array(bodyAb).set(body);
    const bodyHash = await crypto.subtle.digest("SHA-256", bodyAb);
    let digestBin = "";
    for (const b of new Uint8Array(bodyHash)) {
      digestBin += String.fromCharCode(b);
    }
    const digestB64 = btoa(digestBin);
    const digestHeader = `SHA-256=${digestB64}`;

    const date = new Date().toUTCString();
    const host = "digest-test.remote.takos.jp";
    const path = "/inbox";
    const signingString = [
      `(request-target): post ${path}`,
      `host: ${host}`,
      `date: ${date}`,
      `digest: ${digestHeader}`,
    ].join("\n");

    const sig = new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        privateKey,
        new TextEncoder().encode(signingString),
      ),
    );
    let sigBin = "";
    for (const b of sig) sigBin += String.fromCharCode(b);
    const sigB64 = btoa(sigBin);
    const signatureHeader = [
      `keyId="${keyId}"`,
      `algorithm="rsa-sha256"`,
      `headers="(request-target) host date digest"`,
      `signature="${sigB64}"`,
    ].join(",");

    const goodRequest = new Request(`https://${host}${path}`, {
      method: "POST",
      headers: {
        host,
        date,
        digest: digestHeader,
        signature: signatureHeader,
      },
      body,
    });

    const goodResult = await verifyHttpSignature(goodRequest, body);
    assertEquals(goodResult.verified, true);
    assertEquals(goodResult.actorUrl, actorUrl);

    const evilBody = new TextEncoder().encode(
      JSON.stringify({ hello: "evil" }),
    );
    const evilRequest = new Request(`https://${host}${path}`, {
      method: "POST",
      headers: {
        host,
        date,
        digest: digestHeader,
        signature: signatureHeader,
      },
      body: evilBody,
    });

    let thrown: unknown = null;
    try {
      await verifyHttpSignature(evilRequest, evilBody);
    } catch (err) {
      thrown = err;
    }
    assertEquals(thrown instanceof HttpSignatureError, true);
    assertStringIncludes(
      (thrown as Error).message,
      "Digest header does not match",
    );
  } finally {
    globalThis.fetch = originalFetch;
    _resetActorKeyCacheForTests();
  }
});

Deno.test("activitypub store routes - returns Reject on Follow to private repo without visit grant", async () => {
  resetInboxMocks();
  mocks.findCanonicalRepoIncludingPrivate = (async () => ({
    ...REPO_RECORD,
    visibility: "private",
  })) as any;
  mocks.checkGrant = (async () => false) as any;
  let followerAdded = false;
  mocks.addFollower = (async () => {
    followerAdded = true;
    return {
      id: "f1",
      targetActorUrl: "",
      followerActorUrl: "",
      createdAt: "",
    };
  }) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/repos/alice/demo/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        date: new Date().toUTCString(),
        signature: "test-signature",
        "x-test-signature-actor": "https://remote.example/ap/users/bob",
      },
      body: JSON.stringify({
        id: `https://remote.example/activities/${crypto.randomUUID()}`,
        type: "Follow",
        actor: "https://remote.example/ap/users/bob",
        object: "https://test.takos.jp/ap/repos/alice/demo",
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  const payload = await response.json() as Record<string, unknown>;
  assertEquals(payload.type, "Reject");
  assertEquals(payload.actor, "https://test.takos.jp/ap/repos/alice/demo");
  assertEquals(followerAdded, false);
});

Deno.test("activitypub store routes - accepts Follow on private repo when visit grant exists", async () => {
  resetInboxMocks();
  mocks.findCanonicalRepoIncludingPrivate = (async () => ({
    ...REPO_RECORD,
    visibility: "private",
  })) as any;
  mocks.checkGrant = (async () => true) as any;
  let followerAdded = false;
  mocks.addFollower = (async () => {
    followerAdded = true;
    return {
      id: "f1",
      targetActorUrl: "",
      followerActorUrl: "",
      createdAt: "",
    };
  }) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/repos/alice/demo/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        date: new Date().toUTCString(),
        signature: "test-signature",
        "x-test-signature-actor": "https://remote.example/ap/users/bob",
      },
      body: JSON.stringify({
        id: `https://remote.example/activities/${crypto.randomUUID()}`,
        type: "Follow",
        actor: "https://remote.example/ap/users/bob",
        object: "https://test.takos.jp/ap/repos/alice/demo",
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  const payload = await response.json() as Record<string, unknown>;
  assertEquals(payload.type, "Accept");
  assertEquals(followerAdded, true);
});

Deno.test("activitypub store routes - requires signed fetch for private repo actor", async () => {
  resetInboxMocks();
  mocks.findCanonicalRepo = (async () => null) as any;
  mocks.findCanonicalRepoIncludingPrivate = (async () => ({
    ...REPO_RECORD,
    visibility: "private",
  })) as any;
  mocks.checkGrant = (async () => true) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request(
      "https://test.takos.jp/ap/repos/alice/demo?actor=https%3A%2F%2Fremote.example%2Fap%2Fusers%2Fbob",
      {
        headers: {
          date: new Date().toUTCString(),
        },
      },
    ),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
});

Deno.test("activitypub store routes - rejects private repo actor fetch when signature actor differs from actor query", async () => {
  resetInboxMocks();
  mocks.findCanonicalRepo = (async () => null) as any;
  mocks.findCanonicalRepoIncludingPrivate = (async () => ({
    ...REPO_RECORD,
    visibility: "private",
  })) as any;
  mocks.checkGrant = (async () => true) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request(
      "https://test.takos.jp/ap/repos/alice/demo?actor=https%3A%2F%2Fremote.example%2Fap%2Fusers%2Fbob",
      {
        headers: {
          date: new Date().toUTCString(),
          signature: "test-signature",
          "x-test-signature-actor": "https://remote.example/ap/users/eve",
        },
      },
    ),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 403);
});

Deno.test("activitypub store routes - serves private repo actor to signed granted actor", async () => {
  resetInboxMocks();
  mocks.findCanonicalRepo = (async () => null) as any;
  mocks.findCanonicalRepoIncludingPrivate = (async () => ({
    ...REPO_RECORD,
    visibility: "private",
  })) as any;
  mocks.checkGrant = (async () => true) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request(
      "https://test.takos.jp/ap/repos/alice/demo?actor=https%3A%2F%2Fremote.example%2Fap%2Fusers%2Fbob",
      {
        headers: {
          date: new Date().toUTCString(),
          signature: "test-signature",
          "x-test-signature-actor": "https://remote.example/ap/users/bob",
        },
      },
    ),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assertEquals(body.id, "https://test.takos.jp/ap/repos/alice/demo");
  assertEquals(body.pushUri, undefined);
});

Deno.test("activitypub store routes - repo outbox root reports real push totalItems", async () => {
  resetInboxMocks();
  mocks.findCanonicalRepo = (async () => REPO_RECORD) as any;
  mocks.listPushActivities = (async () => ({ total: 42, items: [] })) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/repos/alice/demo/outbox"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  const payload = await response.json() as Record<string, unknown>;
  assertEquals(payload.type, "OrderedCollection");
  assertEquals(payload.totalItems, 42);
});

Deno.test("activitypub store routes - repo outbox reports totalItems 1 for synthetic Create fallback", async () => {
  resetInboxMocks();
  mocks.findCanonicalRepo = (async () => REPO_RECORD) as any;
  mocks.listPushActivities = (async () => ({ total: 0, items: [] })) as any;

  const app = createApp();

  const root = await app.fetch(
    new Request("https://test.takos.jp/ap/repos/alice/demo/outbox"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );
  assertEquals(root.status, 200);
  const rootPayload = await root.json() as Record<string, unknown>;
  assertEquals(rootPayload.totalItems, 1);

  const pageResponse = await app.fetch(
    new Request("https://test.takos.jp/ap/repos/alice/demo/outbox?page=1"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );
  assertEquals(pageResponse.status, 200);
  const pagePayload = await pageResponse.json() as Record<string, unknown>;
  assertEquals(pagePayload.totalItems, 1);
  const items = pagePayload.orderedItems as Array<Record<string, unknown>>;
  assertEquals(items.length, 1);
  assertEquals(items[0].type, "Create");
});

Deno.test("activitypub store routes - Update of remote actor evicts key cache and returns 200", async () => {
  resetInboxMocks();
  mocks.findStoreBySlug = (async () => STORE_RECORD) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        date: new Date().toUTCString(),
        signature: "test-signature",
        "x-test-signature-actor": "https://remote.example/ap/users/bob",
      },
      body: JSON.stringify({
        id: `https://remote.example/activities/${crypto.randomUUID()}`,
        type: "Update",
        actor: "https://remote.example/ap/users/bob",
        object: {
          id: "https://remote.example/ap/users/bob",
          type: "Person",
          name: "Bob Updated",
        },
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  // `evictActorKeyByActorUrl` on an empty cache must be a no-op so repeat
  // Update deliveries stay cheap.
  evictActorKeyByActorUrl("https://remote.example/ap/users/bob");
});

Deno.test("activitypub store routes - Like on inbox is acknowledged with 202", async () => {
  resetInboxMocks();
  mocks.findStoreBySlug = (async () => STORE_RECORD) as any;

  const app = createApp();
  const response = await app.fetch(
    new Request("https://test.takos.jp/ap/stores/alice/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        date: new Date().toUTCString(),
        signature: "test-signature",
        "x-test-signature-actor": "https://remote.example/ap/users/bob",
      },
      body: JSON.stringify({
        id: `https://remote.example/activities/${crypto.randomUUID()}`,
        type: "Like",
        actor: "https://remote.example/ap/users/bob",
      }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 202);
});

Deno.test("buildRejectActivity - builds shape compatible with Mastodon Follow rejection", () => {
  const reject = buildRejectActivity(
    "https://test.takos.jp/ap/repos/alice/demo",
    {
      type: "Follow",
      actor: "https://remote.example/ap/users/bob",
    },
  );

  assertEquals(reject.type, "Reject");
  assertEquals(reject.actor, "https://test.takos.jp/ap/repos/alice/demo");
  assertEquals(
    (reject.to as string[]).includes("https://remote.example/ap/users/bob"),
    true,
  );
  assertEquals(typeof reject.id, "string");
  assertEquals(typeof reject.published, "string");
});
