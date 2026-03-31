import { createPrefixedKvNamespace } from '@/routes/resources/portable-runtime';


import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

  Deno.test('createPrefixedKvNamespace - prefixes kv operations per managed resource and strips prefixes from list results', async () => {
  const baseKv = {
      get: async (key: string) => (key === 'managed-ns:hello' ? 'world' : null),
      getWithMetadata: async (key: string) => ({
        value: key === 'managed-ns:hello' ? 'world' : null,
        metadata: { source: 'shared-store' },
        cacheStatus: null,
      }),
      put: async () => undefined,
      delete: async () => undefined,
      list: async (options?: { prefix?: string }) => ({
        keys: [
          { name: 'managed-ns:hello', metadata: { source: 'shared-store' } },
          { name: 'managed-ns:world' },
          { name: 'other-ns:skip-me' },
        ],
        list_complete: true,
        cursor: options?.prefix ?? '',
      }),
    };

    const kv = createPrefixedKvNamespace(baseKv as never, 'managed-ns');

    await kv.put('hello', 'world');
    const raw = await kv.get('hello', 'text');
    const value = await kv.getWithMetadata('hello', 'text');
    const list = await kv.list({ prefix: 'he' });
    await kv.delete('hello');

    assertSpyCallArgs(baseKv.put, 0, ['managed-ns:hello', 'world', undefined]);
    assertSpyCallArgs(baseKv.get, 0, ['managed-ns:hello', 'text']);
    assertSpyCallArgs(baseKv.getWithMetadata, 0, ['managed-ns:hello', 'text']);
    assertSpyCallArgs(baseKv.list, 0, [{ prefix: 'managed-ns:he' }]);
    assertSpyCallArgs(baseKv.delete, 0, ['managed-ns:hello']);
    assertEquals(raw, 'world');
    assertEquals(value, {
      value: 'world',
      metadata: { source: 'shared-store' },
      cacheStatus: null,
    });
    assertEquals(list, {
      keys: [
        { name: 'hello', metadata: { source: 'shared-store' } },
        { name: 'world' },
      ],
      list_complete: true,
      cursor: 'managed-ns:he',
    });
})