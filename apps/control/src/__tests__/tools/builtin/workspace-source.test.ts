import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/source/repos', () => ({
  checkRepoAccess: vi.fn(),
}));

vi.mock('@/services/source/explore', () => ({
  listCatalogItems: vi.fn(),
}));

vi.mock('@/services/source/fork', () => ({
  forkWithWorkflows: vi.fn(),
}));

import { checkRepoAccess } from '@/services/source/repos';
import { listCatalogItems } from '@/services/source/explore';
import { forkWithWorkflows } from '@/services/source/fork';

import {
  STORE_SEARCH,
  REPO_FORK,
  WORKSPACE_SOURCE_TOOLS,
  WORKSPACE_SOURCE_HANDLERS,
  storeSearchHandler,
  repoForkHandler,
} from '@/tools/builtin/workspace-source';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {
      GIT_OBJECTS: {},
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('workspace source tool definitions', () => {
  it('defines two tools', () => {
    expect(WORKSPACE_SOURCE_TOOLS).toHaveLength(2);
    const names = WORKSPACE_SOURCE_TOOLS.map((t) => t.name);
    expect(names).toContain('store_search');
    expect(names).toContain('repo_fork');
  });

  it('all tools have workspace category', () => {
    for (const def of WORKSPACE_SOURCE_TOOLS) {
      expect(def.category).toBe('workspace');
    }
  });

  it('WORKSPACE_SOURCE_HANDLERS maps all tools', () => {
    for (const def of WORKSPACE_SOURCE_TOOLS) {
      expect(WORKSPACE_SOURCE_HANDLERS).toHaveProperty(def.name);
    }
  });

  it('store_search has no required params', () => {
    expect(STORE_SEARCH.parameters.required).toEqual([]);
  });

  it('repo_fork requires repo_id', () => {
    expect(REPO_FORK.parameters.required).toEqual(['repo_id']);
  });

  it('store_search has sort enum', () => {
    expect(STORE_SEARCH.parameters.properties.sort.enum).toContain('trending');
    expect(STORE_SEARCH.parameters.properties.sort.enum).toContain('new');
    expect(STORE_SEARCH.parameters.properties.sort.enum).toContain('stars');
  });

  it('store_search has type enum', () => {
    expect(STORE_SEARCH.parameters.properties.type.enum).toContain('all');
    expect(STORE_SEARCH.parameters.properties.type.enum).toContain('repo');
    expect(STORE_SEARCH.parameters.properties.type.enum).toContain('deployable-app');
  });
});

// ---------------------------------------------------------------------------
// storeSearchHandler
// ---------------------------------------------------------------------------

describe('storeSearchHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns search results formatted as JSON', async () => {
    vi.mocked(listCatalogItems).mockResolvedValue({
      items: [
        {
          repo: {
            id: 'r1',
            name: 'cool-app',
            owner: { username: 'alice' },
            description: 'A cool app',
            stars: 42,
            forks: 5,
            language: 'TypeScript',
            license: 'MIT',
          },
          takopack: {
            available: true,
            app_id: 'app-1',
            latest_version: '1.0.0',
            category: 'productivity',
            tags: ['tool'],
            publish_status: 'published',
          },
          installation: { installed: true, bundle_deployment_id: 'bd-1' },
        },
      ],
      total: 1,
      has_more: false,
    } as any);

    const result = JSON.parse(await storeSearchHandler({}, makeContext()));

    expect(result.sort).toBe('trending');
    expect(result.type).toBe('all');
    expect(result.total).toBe(1);
    expect(result.items[0].repo_id).toBe('r1');
    expect(result.items[0].repo_name).toBe('cool-app');
    expect(result.items[0].owner_username).toBe('alice');
    expect(result.items[0].stars).toBe(42);
    expect(result.items[0].takopack_available).toBe(true);
    expect(result.items[0].installed_in_current_space).toBe(true);
  });

  it('passes search parameters to listCatalogItems', async () => {
    vi.mocked(listCatalogItems).mockResolvedValue({ items: [], total: 0, has_more: false } as any);

    await storeSearchHandler(
      {
        query: 'test app',
        sort: 'stars',
        type: 'deployable-app',
        limit: 5,
        category: 'productivity',
        language: 'TypeScript',
        tags: 'cool,useful',
        certified_only: true,
      },
      makeContext(),
    );

    expect(listCatalogItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sort: 'stars',
        type: 'deployable-app',
        limit: 5,
        searchQuery: 'test app',
        category: 'productivity',
        language: 'TypeScript',
        tagsRaw: 'cool,useful',
        certifiedOnly: true,
      }),
    );
  });

  it('normalizes invalid sort to default', async () => {
    vi.mocked(listCatalogItems).mockResolvedValue({ items: [], total: 0, has_more: false } as any);

    await storeSearchHandler({ sort: 'invalid' }, makeContext());

    expect(listCatalogItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sort: 'trending' }),
    );
  });

  it('clamps limit to max 20', async () => {
    vi.mocked(listCatalogItems).mockResolvedValue({ items: [], total: 0, has_more: false } as any);

    await storeSearchHandler({ limit: 100 }, makeContext());

    expect(listCatalogItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 20 }),
    );
  });

  it('handles installation not present', async () => {
    vi.mocked(listCatalogItems).mockResolvedValue({
      items: [
        {
          repo: { id: 'r1', name: 'app', owner: { username: 'bob' }, description: '', stars: 0, forks: 0, language: null, license: null },
          takopack: { available: false, app_id: null, latest_version: null, category: null, tags: [], publish_status: null },
          installation: null,
        },
      ],
      total: 1,
      has_more: false,
    } as any);

    const result = JSON.parse(await storeSearchHandler({}, makeContext()));
    expect(result.items[0].installed_in_current_space).toBe(false);
    expect(result.items[0].installation_bundle_deployment_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// repoForkHandler
// ---------------------------------------------------------------------------

describe('repoForkHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when repo_id is empty', async () => {
    await expect(
      repoForkHandler({ repo_id: '' }, makeContext()),
    ).rejects.toThrow('repo_id is required');
  });

  it('throws when repo_id is not provided', async () => {
    await expect(
      repoForkHandler({}, makeContext()),
    ).rejects.toThrow('repo_id is required');
  });

  it('throws when repository is not accessible', async () => {
    vi.mocked(checkRepoAccess).mockResolvedValue(null);

    await expect(
      repoForkHandler({ repo_id: 'r-inaccessible' }, makeContext()),
    ).rejects.toThrow('not found or inaccessible');
  });

  it('forks a repository', async () => {
    vi.mocked(checkRepoAccess).mockResolvedValue({ canRead: true } as any);
    vi.mocked(forkWithWorkflows).mockResolvedValue({
      repository: { id: 'r-fork', name: 'forked-repo' },
      forked_from: { id: 'r-original' },
    } as any);

    const result = JSON.parse(
      await repoForkHandler({ repo_id: 'r-original' }, makeContext()),
    );

    expect(result.success).toBe(true);
    expect(result.repository.id).toBe('r-fork');
    expect(result.forked_from.id).toBe('r-original');
  });

  it('passes custom name to fork', async () => {
    vi.mocked(checkRepoAccess).mockResolvedValue({ canRead: true } as any);
    vi.mocked(forkWithWorkflows).mockResolvedValue({
      repository: { id: 'r-fork', name: 'my-fork' },
      forked_from: { id: 'r-original' },
    } as any);

    await repoForkHandler(
      { repo_id: 'r-original', name: 'my-fork' },
      makeContext(),
    );

    expect(forkWithWorkflows).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'r-original',
      'ws-test',
      { name: 'my-fork' },
    );
  });

  it('trims repo_id whitespace', async () => {
    vi.mocked(checkRepoAccess).mockResolvedValue({ canRead: true } as any);
    vi.mocked(forkWithWorkflows).mockResolvedValue({
      repository: { id: 'r-fork' },
      forked_from: { id: 'r-1' },
    } as any);

    await repoForkHandler({ repo_id: '  r-1  ' }, makeContext());

    expect(checkRepoAccess).toHaveBeenCalledWith(
      expect.anything(),
      'r-1',
      'user-1',
      undefined,
      { allowPublicRead: true },
    );
  });
});
