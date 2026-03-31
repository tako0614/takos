import { describe, expect, it, vi } from 'vitest';
import { createPrefixedKvNamespace } from '@/routes/resources/portable-runtime';

describe('createPrefixedKvNamespace', () => {
  it('prefixes kv operations per managed resource and strips prefixes from list results', async () => {
    const baseKv = {
      get: vi.fn(async (key: string) => (key === 'managed-ns:hello' ? 'world' : null)),
      getWithMetadata: vi.fn(async (key: string) => ({
        value: key === 'managed-ns:hello' ? 'world' : null,
        metadata: { source: 'shared-store' },
        cacheStatus: null,
      })),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async (options?: { prefix?: string }) => ({
        keys: [
          { name: 'managed-ns:hello', metadata: { source: 'shared-store' } },
          { name: 'managed-ns:world' },
          { name: 'other-ns:skip-me' },
        ],
        list_complete: true,
        cursor: options?.prefix ?? '',
      })),
    };

    const kv = createPrefixedKvNamespace(baseKv as never, 'managed-ns');

    await kv.put('hello', 'world');
    const raw = await kv.get('hello', 'text');
    const value = await kv.getWithMetadata('hello', 'text');
    const list = await kv.list({ prefix: 'he' });
    await kv.delete('hello');

    expect(baseKv.put).toHaveBeenCalledWith('managed-ns:hello', 'world', undefined);
    expect(baseKv.get).toHaveBeenCalledWith('managed-ns:hello', 'text');
    expect(baseKv.getWithMetadata).toHaveBeenCalledWith('managed-ns:hello', 'text');
    expect(baseKv.list).toHaveBeenCalledWith({ prefix: 'managed-ns:he' });
    expect(baseKv.delete).toHaveBeenCalledWith('managed-ns:hello');
    expect(raw).toBe('world');
    expect(value).toEqual({
      value: 'world',
      metadata: { source: 'shared-store' },
      cacheStatus: null,
    });
    expect(list).toEqual({
      keys: [
        { name: 'hello', metadata: { source: 'shared-store' } },
        { name: 'world' },
      ],
      list_complete: true,
      cursor: 'managed-ns:he',
    });
  });
});
