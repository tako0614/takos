import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  findStoreBySlug: vi.fn(),
  listStoreRepositories: vi.fn(),
  findStoreRepository: vi.fn(),
  searchStoreRepositories: vi.fn(),
  cache: {
    match: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/routes/activitypub-store/helpers', () => ({
  findStoreBySlug: mocks.findStoreBySlug,
  listStoreRepositories: mocks.listStoreRepositories,
  findStoreRepository: mocks.findStoreRepository,
  searchStoreRepositories: mocks.searchStoreRepositories,
}));

import activitypubStore from '@/routes/activitypub-store';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  app.route('/', activitypubStore);
  return app;
}

describe('activitypub store routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match.mockResolvedValue(undefined);
    mocks.cache.put.mockResolvedValue(undefined);
    mocks.cache.delete.mockResolvedValue(true);
  });

  it('resolves store actors via WebFinger', async () => {
    mocks.findStoreBySlug.mockResolvedValue({
      accountId: 'acct-1',
      accountSlug: 'alice',
      slug: 'alice',
      name: 'Alice',
      description: 'Catalog',
      picture: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      publicRepoCount: 2,
      isDefault: true,
    });

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

  it('serves store actors as Group with pull-only repository catalog metadata', async () => {
    mocks.findStoreBySlug.mockResolvedValue({
      accountId: 'acct-1',
      accountSlug: 'alice',
      slug: 'alice',
      name: 'Alice',
      description: null,
      picture: 'https://cdn.test/alice.png',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      publicRepoCount: 2,
      isDefault: true,
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
      type: 'Group',
      preferredUsername: 'alice',
      name: 'Alice',
      inbox: 'https://test.takos.jp/ap/stores/alice/inbox',
      outbox: 'https://test.takos.jp/ap/stores/alice/outbox',
      followers: 'https://test.takos.jp/ap/stores/alice/followers',
      'tkg:repositories': 'https://test.takos.jp/ap/stores/alice/repositories',
      'tkg:search': 'https://test.takos.jp/ap/stores/alice/search',
      'tkg:repositorySearch': 'https://test.takos.jp/ap/stores/alice/search/repositories',
      'tkg:distributionMode': 'pull-only',
    });
  });

  it('returns an explicit not_implemented contract for store inbox', async () => {
    mocks.findStoreBySlug.mockResolvedValue({
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
    });

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/activity+json' },
        body: JSON.stringify({ type: 'Follow' }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'not_implemented',
      message: 'Store inbox is not implemented. Use outbox polling for updates.',
    });
  });

  it('exposes a proprietary search service and repository search endpoint', async () => {
    mocks.findStoreBySlug.mockResolvedValue({
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
    });
    mocks.searchStoreRepositories.mockResolvedValue({
      total: 1,
      items: [{
        id: 'repo-1',
        ownerId: 'acct-1',
        ownerSlug: 'alice',
        ownerName: 'Alice',
        name: 'demo',
        description: 'Demo repo',
        visibility: 'public',
        defaultBranch: 'main',
        stars: 3,
        forks: 1,
        gitEnabled: true,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }],
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
      type: ['Service', 'tkg:SearchService'],
      'tkg:repositorySearch': 'https://test.takos.jp/ap/stores/alice/search/repositories',
    });

    const summaryResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/search/repositories?q=demo'),
      env,
      {} as ExecutionContext,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      id: 'https://test.takos.jp/ap/stores/alice/search/repositories?q=demo',
      type: 'OrderedCollection',
      totalItems: 1,
      first: 'https://test.takos.jp/ap/stores/alice/search/repositories?q=demo&page=1',
      'tkg:query': 'demo',
    });

    const pageResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/search/repositories?q=demo&page=1&expand=object'),
      env,
      {} as ExecutionContext,
    );
    expect(pageResponse.status).toBe(200);
    await expect(pageResponse.json()).resolves.toMatchObject({
      id: 'https://test.takos.jp/ap/stores/alice/search/repositories?q=demo&page=1',
      type: 'OrderedCollectionPage',
      'tkg:query': 'demo',
      orderedItems: [{
        id: 'https://test.takos.jp/ap/stores/alice/repositories/alice/demo',
        type: ['Document', 'tkg:GitRepository'],
      }],
    });
  });

  it('returns repositories collection summary and paged objects', async () => {
    mocks.findStoreBySlug.mockResolvedValue({
      accountId: 'acct-1',
      accountSlug: 'alice',
      slug: 'alice',
      name: 'Alice',
      description: null,
      picture: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      publicRepoCount: 1,
      isDefault: true,
    });
    mocks.listStoreRepositories.mockResolvedValue({
      total: 1,
      items: [{
        id: 'repo-1',
        ownerId: 'acct-1',
        ownerSlug: 'alice',
        ownerName: 'Alice',
        name: 'demo',
        description: 'Demo repo',
        visibility: 'public',
        defaultBranch: 'main',
        stars: 3,
        forks: 1,
        gitEnabled: true,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }],
    });

    const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const summaryResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/repositories'),
      env,
      {} as ExecutionContext,
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      type: 'OrderedCollection',
      totalItems: 1,
      first: 'https://test.takos.jp/ap/stores/alice/repositories?page=1',
    });

    const pageResponse = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/repositories?page=1&expand=object'),
      env,
      {} as ExecutionContext,
    );
    expect(pageResponse.status).toBe(200);
    await expect(pageResponse.json()).resolves.toMatchObject({
      type: 'OrderedCollectionPage',
      orderedItems: [{
        id: 'https://test.takos.jp/ap/stores/alice/repositories/alice/demo',
        type: ['Document', 'tkg:GitRepository'],
        'tkg:cloneUrl': 'https://test.takos.jp/git/alice/demo.git',
        'tkg:browseUrl': 'https://test.takos.jp/@alice/demo',
        'tkg:branchesEndpoint': 'https://test.takos.jp/@alice/demo/branches',
        'tkg:commitsEndpoint': 'https://test.takos.jp/@alice/demo/commits',
      }],
    });
  });

  it('returns a canonical repository object endpoint', async () => {
    mocks.findStoreRepository.mockResolvedValue({
      id: 'repo-1',
      ownerId: 'acct-1',
      ownerSlug: 'alice',
      ownerName: 'Alice',
      name: 'demo',
      description: 'Demo repo',
      visibility: 'public',
      defaultBranch: 'main',
      stars: 3,
      forks: 1,
      gitEnabled: true,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });

    const app = createApp();
    const response = await app.fetch(
      new Request('https://test.takos.jp/ap/stores/alice/repositories/alice/demo'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'https://test.takos.jp/ap/stores/alice/repositories/alice/demo',
      name: 'demo',
      attributedTo: 'https://test.takos.jp/ap/stores/alice',
      'tkg:defaultBranch': 'main',
      'tkg:refsEndpoint': 'https://test.takos.jp/git/alice/demo.git/info/refs?service=git-upload-pack',
    });
  });

  it('builds outbox entries from repository timestamps', async () => {
    mocks.findStoreBySlug.mockResolvedValue({
      accountId: 'acct-1',
      accountSlug: 'alice',
      slug: 'alice',
      name: 'Alice',
      description: null,
      picture: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      publicRepoCount: 1,
      isDefault: true,
    });
    mocks.listStoreRepositories.mockResolvedValue({
      total: 1,
      items: [{
        id: 'repo-1',
        ownerId: 'acct-1',
        ownerSlug: 'alice',
        ownerName: 'Alice',
        name: 'demo',
        description: 'Demo repo',
        visibility: 'public',
        defaultBranch: 'main',
        stars: 3,
        forks: 1,
        gitEnabled: true,
        createdAt: '2026-03-01T00:00:00.000Z',
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
          id: 'https://test.takos.jp/ap/stores/alice/repositories/alice/demo',
        },
      }],
    });
  });
});
