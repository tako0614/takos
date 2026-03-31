import { assertEquals, assert } from 'jsr:@std/assert';

const redisMock = {
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
    createClient: (options: { url: string }) => {
      calls.push({ url: options.url });
      return createMockClient(options.url);
    },
  };
};

// [Deno] vi.mock removed - manually stub imports from 'redis'
import { createNodeWebEnv, resetNodePlatformStateForTests } from '../../node-platform/env-builder.ts';
import type { RoutingTarget } from '../../application/services/routing/routing-models.ts';


  const originalEnv = {
    REDIS_URL: Deno.env.get('REDIS_URL'),
  };
  Deno.test('local redis-backed bindings - uses redis for local queue and routing persistence when REDIS_URL is set', async () => {
  Deno.env.set('REDIS_URL', 'redis://localhost:6379');
    redisMock.calls.length = 0;
    redisMock.stores.clear();
    await resetNodePlatformStateForTests();
  try {
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

    assert(redisMock.calls.length >= 1);
    assert(redisMock.calls.some((item: any) => JSON.stringify(item) === JSON.stringify({ url: 'redis://localhost:6379' })));

    const store = redisMock.stores.get('redis://localhost:6379');
    assert(store !== undefined);
    assertEquals(store?.lists.get('takos:local:queue:takos-runs'), [
      JSON.stringify({
        body: {
          version: 2,
          runId: 'run-redis',
          timestamp: 1710000000000,
          model: 'gpt-5-mini',
        },
      }),
    ]);

    assertEquals(store?.strings.get('takos:local:routing:redis.example'), JSON.stringify({
      hostname: 'redis.example',
      target,
      version: 1,
      updatedAt: 1710000001234,
    }));

    await assertEquals(await env.ROUTING_STORE!.getRecord('redis.example'), {
      hostname: 'redis.example',
      target,
      version: 1,
      updatedAt: 1710000001234,
    });
  } finally {
  const { REDIS_URL } = originalEnv;
    if (REDIS_URL === undefined) {
      Deno.env.delete('REDIS_URL');
    } else {
      Deno.env.set('REDIS_URL', REDIS_URL);
    }
    /* TODO: call fakeTime.restore() */ void 0;
    await resetNodePlatformStateForTests();
    /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})