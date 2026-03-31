import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals, assertStringIncludes, assertObjectMatch } from 'jsr:@std/assert';

const mocks = ({
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
});

// [Deno] vi.mock removed - manually stub imports from '@/routes/activitypub-store/activitypub-queries'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/activitypub/push-activities'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/activitypub/store-inventory'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/activitypub/grants'
// [Deno] vi.mock removed - manually stub imports from '@/middleware/http-signature'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/activitypub/followers'
import activitypubStore from '@/routes/activitypub-store/routes';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  app.route('/', activitypubStore);
  return app;
}

const STORE_RECORD = {
  accountId: 'acct-1',
  accountSlug: 'alice',
  slug: 'alice',
  name: 'Alice',
  description: null,
  picture: null,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  publicRepoCount: 2,
  isDefault: true,
};

const REPO_RECORD = {
  id: 'repo-1',
  ownerId: 'acct-1',
  ownerSlug: 'alice',
  ownerName: 'Alice',
  name: 'demo',
  description: 'Demo repo',
  visibility: 'public',
  defaultBranch: 'main',
  defaultBranchHash: 'abc123def456',
  stars: 3,
  forks: 1,
  gitEnabled: true,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};


  Deno.test('activitypub store routes - resolves store actors via WebFinger', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
    mocks.removeFollower = (async () => true) as any;
    mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match = (async () => undefined) as any;
    mocks.cache.put = (async () => undefined) as any;
    mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug = (async () => ({ ...STORE_RECORD, description: 'Catalog' })) as any;

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/.well-known/webfinger?resource=acct:alice@test.takos.jp'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    assertStringIncludes(response.headers.get('Content-Type'), 'application/jrd+json');
    await assertObjectMatch(await response.json(), {
      subject: 'acct:alice@test.takos.jp',
      aliases: ['https://test.takos.jp/ap/stores/alice'],
    });
})
  Deno.test('activitypub store routes - resolves canonical repo actors via WebFinger URL', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      new Request('https://test.takos.jp/.well-known/webfinger?resource=https://test.takos.jp/ap/repos/alice/demo'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      aliases: ['https://test.takos.jp/ap/repos/alice/demo'],
      links: [{ rel: 'self', type: 'application/activity+json', href: 'https://test.takos.jp/ap/repos/alice/demo' }],
    });
})
  Deno.test('activitypub store routes - serves store actors as Service+Store with inventory', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      picture: 'https://cdn.test/alice.png',
    })) as any;

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    assertStringIncludes(response.headers.get('Content-Type'), 'application/activity+json');

    await assertObjectMatch(await response.json(), {
      id: 'https://test.takos.jp/ap/stores/alice',
      type: ['Service', 'Store'],
      preferredUsername: 'alice',
      name: 'Alice',
      inbox: 'https://test.takos.jp/ap/stores/alice/inbox',
      outbox: 'https://test.takos.jp/ap/stores/alice/outbox',
      followers: 'https://test.takos.jp/ap/stores/alice/followers',
      inventory: 'https://test.takos.jp/ap/stores/alice/inventory',
      search: 'https://test.takos.jp/ap/stores/alice/search',
      repositorySearch: 'https://test.takos.jp/ap/stores/alice/search/repositories',
    });
})
  Deno.test('activitypub store routes - accepts Follow on store inbox and returns Accept', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      new Request('https://test.takos.jp/ap/stores/alice/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/activity+json' },
        body: JSON.stringify({
          type: 'Follow',
          actor: 'https://remote.example/ap/users/bob',
          object: 'https://test.takos.jp/ap/stores/alice',
        }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      type: 'Accept',
      actor: 'https://test.takos.jp/ap/stores/alice',
      object: {
        type: 'Follow',
        actor: 'https://remote.example/ap/users/bob',
      },
    });
})
  Deno.test('activitypub store routes - rejects unsupported activity types on inbox', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      new Request('https://test.takos.jp/ap/stores/alice/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/activity+json' },
        body: JSON.stringify({ type: 'Like', actor: 'https://remote.example/ap/users/bob' }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 422);
})
  Deno.test('activitypub store routes - serves inventory collection with ForgeFed Repository actors', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
    mocks.removeFollower = (async () => true) as any;
    mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match = (async () => undefined) as any;
    mocks.cache.put = (async () => undefined) as any;
    mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug = (async () => ({ ...STORE_RECORD, publicRepoCount: 1 })) as any;
    mocks.listStoreRepositories = (async () => ({
      total: 1,
      items: [REPO_RECORD],
    })) as any;

    const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const summaryResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/inventory'),
      env,
      {} as ExecutionContext,
    );
    assertEquals(summaryResponse.status, 200);
    await assertObjectMatch(await summaryResponse.json(), {
      type: 'OrderedCollection',
      totalItems: 1,
      first: 'https://test.takos.jp/ap/stores/alice/inventory?page=1',
    });

    const pageResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/inventory?page=1&expand=object'),
      env,
      {} as ExecutionContext,
    );
    assertEquals(pageResponse.status, 200);
    await assertObjectMatch(await pageResponse.json(), {
      type: 'OrderedCollectionPage',
      orderedItems: [{
        id: 'https://test.takos.jp/ap/repos/alice/demo',
        type: 'Repository',
        name: 'demo',
        cloneUri: ['https://test.takos.jp/git/alice/demo.git'],
        defaultBranchRef: 'refs/heads/main',
        inbox: 'https://test.takos.jp/ap/repos/alice/demo/inbox',
        outbox: 'https://test.takos.jp/ap/repos/alice/demo/outbox',
        stores: 'https://test.takos.jp/ap/repos/alice/demo/stores',
      }],
    });
})
  Deno.test('activitypub store routes - search service uses plain field names', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      new Request('https://test.takos.jp/ap/stores/alice/search'),
      env,
      {} as ExecutionContext,
    );
    assertEquals(serviceResponse.status, 200);
    await assertObjectMatch(await serviceResponse.json(), {
      id: 'https://test.takos.jp/ap/stores/alice/search',
      type: 'Service',
      repositorySearch: 'https://test.takos.jp/ap/stores/alice/search/repositories',
    });

    const pageResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/search/repositories?q=demo&page=1&expand=object'),
      env,
      {} as ExecutionContext,
    );
    assertEquals(pageResponse.status, 200);
    await assertObjectMatch(await pageResponse.json(), {
      type: 'OrderedCollectionPage',
      orderedItems: [{
        id: 'https://test.takos.jp/ap/repos/alice/demo',
        type: 'Repository',
      }],
    });
})
  Deno.test('activitypub store routes - returns canonical repository actor at /ap/repos/:owner/:repo', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      updatedAt: '2026-03-02T00:00:00.000Z',
    })) as any;

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/repos/alice/demo'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      id: 'https://test.takos.jp/ap/repos/alice/demo',
      type: 'Repository',
      name: 'demo',
      inbox: 'https://test.takos.jp/ap/repos/alice/demo/inbox',
      outbox: 'https://test.takos.jp/ap/repos/alice/demo/outbox',
      followers: 'https://test.takos.jp/ap/repos/alice/demo/followers',
      cloneUri: ['https://test.takos.jp/git/alice/demo.git'],
      stores: 'https://test.takos.jp/ap/repos/alice/demo/stores',
      defaultBranchRef: 'refs/heads/main',
    });
})
  Deno.test('activitypub store routes - returns stores collection for a canonical repo', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      new Request('https://test.takos.jp/ap/repos/alice/demo/stores?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      type: 'OrderedCollectionPage',
      orderedItems: ['https://test.takos.jp/ap/stores/alice'],
    });
})
  Deno.test('activitypub store routes - builds outbox entries with ForgeFed Repository objects', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
    mocks.removeFollower = (async () => true) as any;
    mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match = (async () => undefined) as any;
    mocks.cache.put = (async () => undefined) as any;
    mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug = (async () => ({ ...STORE_RECORD, publicRepoCount: 1 })) as any;
    mocks.listStoreRepositories = (async () => ({
      total: 1,
      items: [{
        ...REPO_RECORD,
        updatedAt: '2026-03-02T00:00:00.000Z',
      }],
    })) as any;

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/outbox?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      type: 'OrderedCollectionPage',
      orderedItems: [{
        type: 'Update',
        actor: 'https://test.takos.jp/ap/stores/alice',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        object: {
          id: 'https://test.takos.jp/ap/repos/alice/demo',
          type: 'Repository',
        },
      }],
    });
})
  Deno.test('activitypub store routes - redirects legacy /repositories to /inventory', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      new Request('https://test.takos.jp/ap/stores/alice/repositories?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 301);
    assertEquals(response.headers.get('Location'), 
      'https://test.takos.jp/ap/stores/alice/inventory?page=1',
    );
})
  Deno.test('activitypub store routes - redirects legacy /ns/takos-git to /ns/takos', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      new Request('https://test.takos.jp/ns/takos-git'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 301);
    assertEquals(response.headers.get('Location'), 'https://test.takos.jp/ns/takos');
})
  Deno.test('activitypub store routes - serves takos namespace context at /ns/takos', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      new Request('https://test.takos.jp/ns/takos'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    assertStringIncludes(response.headers.get('Content-Type'), 'application/ld+json');
    const body = await response.json() as Record<string, unknown>;
    const ctx = body['@context'] as Record<string, unknown>;
    assertEquals(ctx.takos, 'https://takos.jp/ns#');
    assertEquals(ctx.Store, 'takos:Store');
    assertEquals(ctx.inventory, { '@id': 'takos:inventory', '@type': '@id' });
})
  Deno.test('activitypub store routes - includes pushUri and defaultBranchHash in repo actor', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
      new Request('https://test.takos.jp/ap/repos/alice/demo'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      pushUri: ['https://test.takos.jp/git/alice/demo.git'],
      defaultBranchHash: 'abc123def456',
    });
})
  Deno.test('activitypub store routes - serves Add/Remove activities in store outbox (explicit mode)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
    mocks.removeFollower = (async () => true) as any;
    mocks.listFollowers = (async () => ({ total: 0, items: [] })) as any;
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match = (async () => undefined) as any;
    mocks.cache.put = (async () => undefined) as any;
    mocks.cache.delete = (async () => true) as any;
  mocks.findStoreBySlug = (async () => ({ ...STORE_RECORD, publicRepoCount: 1 })) as any;
    mocks.hasExplicitInventory = (async () => true) as any;
    mocks.listInventoryActivities = (async () => ({
      total: 2,
      items: [
        {
          id: 'inv-2',
          storeSlug: 'alice',
          accountId: 'acct-1',
          repoActorUrl: 'https://remote.example/ap/repos/bob/tool',
          activityType: 'Add',
          isActive: true,
          createdAt: '2026-03-02T00:00:00.000Z',
        },
        {
          id: 'inv-1',
          storeSlug: 'alice',
          accountId: 'acct-1',
          repoActorUrl: 'https://test.takos.jp/ap/repos/alice/demo',
          activityType: 'Add',
          isActive: true,
          createdAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    })) as any;

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/outbox?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      type: 'OrderedCollectionPage',
      orderedItems: [
        {
          type: 'Add',
          actor: 'https://test.takos.jp/ap/stores/alice',
          object: 'https://remote.example/ap/repos/bob/tool',
          target: 'https://test.takos.jp/ap/stores/alice/inventory',
        },
        {
          type: 'Add',
          actor: 'https://test.takos.jp/ap/stores/alice',
          object: 'https://test.takos.jp/ap/repos/alice/demo',
          target: 'https://test.takos.jp/ap/stores/alice/inventory',
        },
      ],
    });
})
  Deno.test('activitypub store routes - serves Push activities with commit metadata in repo outbox', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // Default to auto-list mode
    mocks.hasExplicitInventory = (async () => false) as any;
    mocks.listInventoryItems = (async () => ({ total: 0, items: [] })) as any;
    mocks.listPushActivitiesForRepoIds = (async () => ({ total: 0, items: [] })) as any;
    mocks.checkGrant = (async () => false) as any;
    mocks.addFollower = (async () => ({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' })) as any;
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
        id: 'push-1',
        repoId: 'repo-1',
        accountId: 'acct-1',
        ref: 'refs/heads/main',
        beforeSha: 'aaaa000',
        afterSha: 'bbbb111',
        pusherActorUrl: null,
        pusherName: 'Alice',
        commitCount: 1,
        commits: [{
          hash: 'bbbb111',
          message: 'feat: add division',
          authorName: 'Alice',
          authorEmail: 'alice@example.com',
          committed: '2026-03-02T00:00:00.000Z',
        }],
        createdAt: '2026-03-02T00:00:00.000Z',
      }],
    })) as any;

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/repos/alice/demo/outbox?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assertObjectMatch(body, {
      type: 'OrderedCollectionPage',
      orderedItems: [{
        type: 'Push',
        actor: 'https://test.takos.jp/ap/repos/alice/demo',
        target: 'refs/heads/main',
        object: {
          type: 'OrderedCollection',
          totalItems: 1,
          orderedItems: [{
            type: 'Commit',
            hash: 'bbbb111',
            message: 'feat: add division',
            attributedTo: { name: 'Alice', email: 'alice@example.com' },
          }],
        },
      }],
    });
})
