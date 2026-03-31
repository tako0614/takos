import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  findStoreBySlug: vi.fn(),
  findCanonicalRepo: vi.fn(),
  findCanonicalRepoIncludingPrivate: vi.fn(),
  listStoreRepositories: vi.fn(),
  listStoresForRepo: vi.fn(),
  findStoreRepository: vi.fn(),
  searchStoreRepositories: vi.fn(),
  listPushActivities: vi.fn(),
  listPushActivitiesForRepoIds: vi.fn(),
  hasExplicitInventory: vi.fn(),
  listInventoryActivities: vi.fn(),
  listInventoryItems: vi.fn(),
  addFollower: vi.fn(),
  removeFollower: vi.fn(),
  listFollowers: vi.fn(),
  countFollowers: vi.fn(),
  checkGrant: vi.fn(),
  cache: {
    match: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/routes/activitypub-store/activitypub-queries', () => ({
  findStoreBySlug: mocks.findStoreBySlug,
  findCanonicalRepo: mocks.findCanonicalRepo,
  findCanonicalRepoIncludingPrivate: mocks.findCanonicalRepoIncludingPrivate,
  listStoreRepositories: mocks.listStoreRepositories,
  listStoresForRepo: mocks.listStoresForRepo,
  findStoreRepository: mocks.findStoreRepository,
  searchStoreRepositories: mocks.searchStoreRepositories,
}));

vi.mock('@/application/services/activitypub/push-activities', () => ({
  listPushActivities: mocks.listPushActivities,
  listPushActivitiesForRepoIds: mocks.listPushActivitiesForRepoIds,
  DELETE_REF: '__delete__',
}));

vi.mock('@/application/services/activitypub/store-inventory', () => ({
  hasExplicitInventory: mocks.hasExplicitInventory,
  listInventoryActivities: mocks.listInventoryActivities,
  listInventoryItems: mocks.listInventoryItems,
}));

vi.mock('@/application/services/activitypub/grants', () => ({
  checkGrant: mocks.checkGrant,
}));

vi.mock('@/middleware/http-signature', () => ({
  verifyHttpSignature: vi.fn(),
  HttpSignatureError: class HttpSignatureError extends Error {},
}));

vi.mock('@/application/services/activitypub/followers', () => ({
  addFollower: mocks.addFollower,
  removeFollower: mocks.removeFollower,
  listFollowers: mocks.listFollowers,
  countFollowers: mocks.countFollowers,
}));

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

describe('activitypub store routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to auto-list mode
    mocks.hasExplicitInventory.mockResolvedValue(false);
    mocks.listInventoryItems.mockResolvedValue({ total: 0, items: [] });
    mocks.listPushActivitiesForRepoIds.mockResolvedValue({ total: 0, items: [] });
    mocks.checkGrant.mockResolvedValue(false);
    mocks.addFollower.mockResolvedValue({ id: 'f1', targetActorUrl: '', followerActorUrl: '', createdAt: '' });
    mocks.removeFollower.mockResolvedValue(true);
    mocks.listFollowers.mockResolvedValue({ total: 0, items: [] });
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match.mockResolvedValue(undefined);
    mocks.cache.put.mockResolvedValue(undefined);
    mocks.cache.delete.mockResolvedValue(true);
  });

  it('resolves store actors via WebFinger', async () => {
    mocks.findStoreBySlug.mockResolvedValue({ ...STORE_RECORD, description: 'Catalog' });

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/.well-known/webfinger?resource=acct:alice@test.takos.jp'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/jrd+json');
    await expect(response.json()).resolves.toMatchObject({
      subject: 'acct:alice@test.takos.jp',
      aliases: ['https://test.takos.jp/ap/stores/alice'],
    });
  });

  it('resolves canonical repo actors via WebFinger URL', async () => {
    mocks.findCanonicalRepo.mockResolvedValue(REPO_RECORD);

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/.well-known/webfinger?resource=https://test.takos.jp/ap/repos/alice/demo'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      aliases: ['https://test.takos.jp/ap/repos/alice/demo'],
      links: [{ rel: 'self', type: 'application/activity+json', href: 'https://test.takos.jp/ap/repos/alice/demo' }],
    });
  });

  it('serves store actors as Service+Store with inventory', async () => {
    mocks.findStoreBySlug.mockResolvedValue({
      ...STORE_RECORD,
      picture: 'https://cdn.test/alice.png',
    });

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/activity+json');

    await expect(response.json()).resolves.toMatchObject({
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
  });

  it('accepts Follow on store inbox and returns Accept', async () => {
    mocks.findStoreBySlug.mockResolvedValue(STORE_RECORD);

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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 'Accept',
      actor: 'https://test.takos.jp/ap/stores/alice',
      object: {
        type: 'Follow',
        actor: 'https://remote.example/ap/users/bob',
      },
    });
  });

  it('rejects unsupported activity types on inbox', async () => {
    mocks.findStoreBySlug.mockResolvedValue(STORE_RECORD);

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

    expect(response.status).toBe(422);
  });

  it('serves inventory collection with ForgeFed Repository actors', async () => {
    mocks.findStoreBySlug.mockResolvedValue({ ...STORE_RECORD, publicRepoCount: 1 });
    mocks.listStoreRepositories.mockResolvedValue({
      total: 1,
      items: [REPO_RECORD],
    });

    const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const summaryResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/inventory'),
      env,
      {} as ExecutionContext,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      type: 'OrderedCollection',
      totalItems: 1,
      first: 'https://test.takos.jp/ap/stores/alice/inventory?page=1',
    });

    const pageResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/inventory?page=1&expand=object'),
      env,
      {} as ExecutionContext,
    );
    expect(pageResponse.status).toBe(200);
    await expect(pageResponse.json()).resolves.toMatchObject({
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
  });

  it('search service uses plain field names', async () => {
    mocks.findStoreBySlug.mockResolvedValue(STORE_RECORD);
    mocks.searchStoreRepositories.mockResolvedValue({
      total: 1,
      items: [REPO_RECORD],
    });

    const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const serviceResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/search'),
      env,
      {} as ExecutionContext,
    );
    expect(serviceResponse.status).toBe(200);
    await expect(serviceResponse.json()).resolves.toMatchObject({
      id: 'https://test.takos.jp/ap/stores/alice/search',
      type: 'Service',
      repositorySearch: 'https://test.takos.jp/ap/stores/alice/search/repositories',
    });

    const pageResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/search/repositories?q=demo&page=1&expand=object'),
      env,
      {} as ExecutionContext,
    );
    expect(pageResponse.status).toBe(200);
    await expect(pageResponse.json()).resolves.toMatchObject({
      type: 'OrderedCollectionPage',
      orderedItems: [{
        id: 'https://test.takos.jp/ap/repos/alice/demo',
        type: 'Repository',
      }],
    });
  });

  it('returns canonical repository actor at /ap/repos/:owner/:repo', async () => {
    mocks.findCanonicalRepo.mockResolvedValue({
      ...REPO_RECORD,
      updatedAt: '2026-03-02T00:00:00.000Z',
    });

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/repos/alice/demo'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
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
  });

  it('returns stores collection for a canonical repo', async () => {
    mocks.findCanonicalRepo.mockResolvedValue(REPO_RECORD);
    mocks.listStoresForRepo.mockResolvedValue([STORE_RECORD]);

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/repos/alice/demo/stores?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 'OrderedCollectionPage',
      orderedItems: ['https://test.takos.jp/ap/stores/alice'],
    });
  });

  it('builds outbox entries with ForgeFed Repository objects', async () => {
    mocks.findStoreBySlug.mockResolvedValue({ ...STORE_RECORD, publicRepoCount: 1 });
    mocks.listStoreRepositories.mockResolvedValue({
      total: 1,
      items: [{
        ...REPO_RECORD,
        updatedAt: '2026-03-02T00:00:00.000Z',
      }],
    });

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/outbox?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
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
  });

  it('redirects legacy /repositories to /inventory', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/repositories?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe(
      'https://test.takos.jp/ap/stores/alice/inventory?page=1',
    );
  });

  it('redirects legacy /ns/takos-git to /ns/takos', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ns/takos-git'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://test.takos.jp/ns/takos');
  });

  it('serves takos namespace context at /ns/takos', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ns/takos'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/ld+json');
    const body = await response.json() as Record<string, unknown>;
    const ctx = body['@context'] as Record<string, unknown>;
    expect(ctx.takos).toBe('https://takos.jp/ns#');
    expect(ctx.Store).toBe('takos:Store');
    expect(ctx.inventory).toEqual({ '@id': 'takos:inventory', '@type': '@id' });
  });

  it('includes pushUri and defaultBranchHash in repo actor', async () => {
    mocks.findCanonicalRepo.mockResolvedValue(REPO_RECORD);

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/repos/alice/demo'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pushUri: ['https://test.takos.jp/git/alice/demo.git'],
      defaultBranchHash: 'abc123def456',
    });
  });

  it('serves Add/Remove activities in store outbox (explicit mode)', async () => {
    mocks.findStoreBySlug.mockResolvedValue({ ...STORE_RECORD, publicRepoCount: 1 });
    mocks.hasExplicitInventory.mockResolvedValue(true);
    mocks.listInventoryActivities.mockResolvedValue({
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
    });

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/outbox?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
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
  });

  it('serves Push activities with commit metadata in repo outbox', async () => {
    mocks.findCanonicalRepo.mockResolvedValue(REPO_RECORD);
    mocks.listPushActivities.mockResolvedValue({
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
    });

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/repos/alice/demo/outbox?page=1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
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
  });

});
