import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => {
  type Store = {
    strings: Map<string, string>;
    lists: Map<string, string[]>;
  };

  const stores = new Map<string, Store>();
  const calls: Array<{ url: string }> = [];

  function getStore(url: string): Store {
    const existing = stores.get(url);
    if (existing) return existing;
    const next: Store = {
      strings: new Map(),
      lists: new Map(),
    };
    stores.set(url, next);
    return next;
  }

  function createMockClient(url: string) {
    const store = getStore(url);
    const client = {
      async connect() {
        return client;
      },
      async get(key: string) {
        return store.strings.get(key) ?? null;
      },
      async set(key: string, value: string) {
        store.strings.set(key, value);
        return 'OK';
      },
      async del(key: string) {
        store.strings.delete(key);
        store.lists.delete(key);
        return 1;
      },
      async rPush(key: string, ...values: string[]) {
        const list = store.lists.get(key) ?? [];
        list.push(...values);
        store.lists.set(key, list);
        return list.length;
      },
      async lRange(key: string, start: number, end: number) {
        const list = store.lists.get(key) ?? [];
        const effectiveEnd = end < 0 ? list.length - 1 : end;
        return list.slice(start, effectiveEnd + 1);
      },
      destroy() {
        return Promise.resolve();
      },
      close() {
        return Promise.resolve();
      },
    };
    return client;
  }

  return {
    calls,
    stores,
    createClient: vi.fn((options: { url: string }) => {
      calls.push({ url: options.url });
      return createMockClient(options.url);
    }),
  };
});

vi.mock('redis', () => ({
  createClient: redisMock.createClient,
}));

import { createNodeWebEnv, resetNodePlatformStateForTests } from '../../node-platform/env-builder';
import type { RoutingTarget } from '../../application/services/routing/routing-models.ts';

describe('local redis-backed bindings', () => {
  const originalEnv = {
    REDIS_URL: process.env.REDIS_URL,
  };

  beforeEach(async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    redisMock.calls.length = 0;
    redisMock.stores.clear();
    await resetNodePlatformStateForTests();
  });

  afterEach(async () => {
    const { REDIS_URL } = originalEnv;
    if (REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = REDIS_URL;
    }
    vi.useRealTimers();
    await resetNodePlatformStateForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses redis for local queue and routing persistence when REDIS_URL is set', async () => {
    const env = await createNodeWebEnv();
    const target: RoutingTarget = {
      type: 'deployments',
      deployments: [{ routeRef: 'tenant-app', weight: 100, status: 'active' }],
    };

    await env.RUN_QUEUE.send({
      version: 2,
      runId: 'run-redis',
      timestamp: 1710000000000,
      model: 'gpt-5-mini',
    });
    await env.ROUTING_STORE!.putRecord('Redis.Example', target, 1710000001234);

    expect(redisMock.calls.length).toBeGreaterThanOrEqual(1);
    expect(redisMock.calls).toContainEqual({ url: 'redis://localhost:6379' });

    const store = redisMock.stores.get('redis://localhost:6379');
    expect(store).toBeDefined();
    expect(store?.lists.get('takos:local:queue:takos-runs')).toEqual([
      JSON.stringify({
        body: {
          version: 2,
          runId: 'run-redis',
          timestamp: 1710000000000,
          model: 'gpt-5-mini',
        },
      }),
    ]);

    expect(store?.strings.get('takos:local:routing:redis.example')).toBe(JSON.stringify({
      hostname: 'redis.example',
      target,
      version: 1,
      updatedAt: 1710000001234,
    }));

    await expect(env.ROUTING_STORE!.getRecord('redis.example')).resolves.toEqual({
      hostname: 'redis.example',
      target,
      version: 1,
      updatedAt: 1710000001234,
    });
  });
});
