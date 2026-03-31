import { assert, assertEquals } from 'jsr:@std/assert';
import {
  createNodeWebEnv,
  resetNodePlatformStateForTests,
} from '../../node-platform/env-builder.ts';
import {
  resetRedisClientForTests,
  setRedisClientFactoryForTests,
} from '../redis-bindings.ts';
import type { RoutingTarget } from '../../application/services/routing/routing-models.ts';

type Store = {
  lists: Map<string, string[]>;
  strings: Map<string, string>;
};

const stores = new Map<string, Store>();
const calls: Array<{ url: string }> = [];

function getStore(url: string): Store {
  const existing = stores.get(url);
  if (existing) {
    return existing;
  }

  const next: Store = {
    lists: new Map(),
    strings: new Map(),
  };
  stores.set(url, next);
  return next;
}

function installRedisMock(): void {
  setRedisClientFactoryForTests(((options: { url: string }) => {
    calls.push({ url: options.url });
    const store = getStore(options.url);

    return {
      async connect() {
        return this;
      },
      async get(key: string) {
        return store.strings.get(key) ?? null;
      },
      async set(key: string, value: string) {
        store.strings.set(key, value);
        return 'OK';
      },
      async lRange(key: string, start: number, end: number) {
        const list = store.lists.get(key) ?? [];
        const effectiveEnd = end < 0 ? list.length - 1 : end;
        return list.slice(start, effectiveEnd + 1);
      },
      async lPop(key: string) {
        const list = store.lists.get(key) ?? [];
        const value = list.shift() ?? null;
        store.lists.set(key, list);
        return value;
      },
      async rPush(key: string, ...values: string[]) {
        const list = store.lists.get(key) ?? [];
        list.push(...values);
        store.lists.set(key, list);
        return list.length;
      },
      async close() {
        return;
      },
      destroy() {
        return;
      },
    };
  }) as typeof import('redis').createClient);
}

Deno.test('local redis-backed bindings - uses redis for local queue and routing persistence when REDIS_URL is set', async () => {
  const originalRedisUrl = Deno.env.get('REDIS_URL');
  Deno.env.set('REDIS_URL', 'redis://localhost:6379');
  calls.length = 0;
  stores.clear();
  installRedisMock();
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

    assert(calls.length >= 1);
    assertEquals(calls.some((item) => item.url === 'redis://localhost:6379'), true);

    const store = stores.get('redis://localhost:6379');
    assert(store !== undefined);
    assertEquals(store.lists.get('takos:local:queue:takos-runs'), [
      JSON.stringify({
        body: {
          version: 2,
          runId: 'run-redis',
          timestamp: 1710000000000,
          model: 'gpt-5-mini',
        },
      }),
    ]);
    assertEquals(
      store.strings.get('takos:local:routing:redis.example'),
      JSON.stringify({
        hostname: 'redis.example',
        target,
        version: 1,
        updatedAt: 1710000001234,
      }),
    );

    assertEquals(await env.ROUTING_STORE!.getRecord('redis.example'), {
      hostname: 'redis.example',
      target,
      version: 1,
      updatedAt: 1710000001234,
    });
  } finally {
    if (originalRedisUrl === undefined) {
      Deno.env.delete('REDIS_URL');
    } else {
      Deno.env.set('REDIS_URL', originalRedisUrl);
    }
    setRedisClientFactoryForTests(null);
    resetRedisClientForTests();
    await resetNodePlatformStateForTests();
  }
});
