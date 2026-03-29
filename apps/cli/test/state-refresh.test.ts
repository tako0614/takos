import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareStateRefreshProvider } from '../src/lib/state/cloudflare-refresh-provider.js';
import { refreshState } from '../src/lib/state/refresh.js';
import type { RefreshableProvider } from '../src/lib/state/refresh.js';
import type { TakosState } from '../src/lib/state/state-types.js';

function makeState(overrides: Partial<TakosState> = {}): TakosState {
  return {
    version: 1,
    provider: 'cloudflare',
    env: 'staging',
    group: 'default',
    groupName: 'test-group',
    updatedAt: '2026-01-01T00:00:00Z',
    resources: {},
    workers: {},
    containers: {},
    services: {},
    routes: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('refreshState', () => {
  it('removes confirmed missing resources and workers', async () => {
    const provider: RefreshableProvider = {
      async checkResourceExists(type: string, id: string): Promise<boolean | null> {
        if (type === 'd1' && id === 'missing-db') return false;
        if (type === 'worker' && id === 'missing-worker') return false;
        return true;
      },
    };

    const state = makeState({
      resources: {
        db: { type: 'd1', id: 'missing-db', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
        cache: { type: 'kv', id: 'live-kv', binding: 'CACHE', createdAt: '2026-01-01T00:00:00Z' },
        token: { type: 'secretRef', id: 'secret-value', binding: 'TOKEN', createdAt: '2026-01-01T00:00:00Z' },
      },
      workers: {
        web: { scriptName: 'missing-worker', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:1' },
      },
      containers: {
        api: { deployedAt: '2026-01-01T00:00:00Z', imageHash: 'sha256:container' },
      },
      services: {
        backend: { deployedAt: '2026-01-01T00:00:00Z', imageHash: 'sha256:service', ipv4: '10.0.0.1' },
      },
      routes: {
        home: { target: 'workers.web', path: '/' },
      },
    });

    const result = await refreshState(state, provider);

    expect(state.resources.db).toBeUndefined();
    expect(state.resources.cache).toBeDefined();
    expect(state.workers.web).toBeUndefined();
    expect(result.changes.some((change) => change.key === 'resources.db' && change.action === 'removed')).toBe(true);
    expect(result.changes.some((change) => change.key === 'workers.web' && change.action === 'removed')).toBe(true);
    expect(result.changes.some((change) => change.key === 'resources.token' && change.action === 'warning')).toBe(true);
    expect(result.changes.some((change) => change.key === 'containers.api' && change.action === 'warning')).toBe(true);
    expect(result.changes.some((change) => change.key === 'services.backend' && change.action === 'warning')).toBe(true);
    expect(result.changes.some((change) => change.key === 'routes.home' && change.action === 'warning')).toBe(true);
  });

  it('does not delete entries when verification is unavailable', async () => {
    const provider: RefreshableProvider = {
      async checkResourceExists(): Promise<boolean | null> {
        return null;
      },
    };

    const state = makeState({
      resources: {
        db: { type: 'd1', id: 'db-id', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
      },
      workers: {
        web: { scriptName: 'web-script', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:1' },
      },
    });

    const result = await refreshState(state, provider);

    expect(state.resources.db).toBeDefined();
    expect(state.workers.web).toBeDefined();
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'resources.db',
        action: 'warning',
      }),
      expect.objectContaining({
        key: 'workers.web',
        action: 'warning',
      }),
    ]));
  });
});

describe('CloudflareStateRefreshProvider', () => {
  it('checks the Cloudflare endpoints used by state refresh', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/workers/scripts/missing-worker')) {
        return new Response('', { status: 404 });
      }
      return new Response('', { status: 200 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const provider = new CloudflareStateRefreshProvider('acct-123', 'token-456');

    await expect(provider.checkResourceExists('d1', 'db-1', 'db')).resolves.toBe(true);
    await expect(provider.checkResourceExists('r2', 'bucket-name', 'bucket')).resolves.toBe(true);
    await expect(provider.checkResourceExists('kv', 'namespace-id', 'cache')).resolves.toBe(true);
    await expect(provider.checkResourceExists('queue', 'task-queue', 'queue')).resolves.toBe(true);
    await expect(provider.checkResourceExists('vectorize', 'embeddings', 'vector')).resolves.toBe(true);
    await expect(provider.checkResourceExists('worker', 'missing-worker', 'web')).resolves.toBe(false);
    await expect(provider.checkResourceExists('secretRef', 'secret-value', 'secret')).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/d1/database/db-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/r2/buckets/bucket-name',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/storage/kv/namespaces/namespace-id',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/queues/task-queue',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/vectorize/v2/indexes/embeddings',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/workers/scripts/missing-worker',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
