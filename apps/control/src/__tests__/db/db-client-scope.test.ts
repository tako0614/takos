import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

const mocks = vi.hoisted(() => {
  const drizzleInstances: unknown[] = [];
  const mockDrizzle = vi.fn((db: unknown, _opts?: unknown) => {
    const instance = { _d1: db };
    drizzleInstances.push(instance);
    return instance;
  });
  return { drizzleInstances, mockDrizzle };
});

vi.mock('drizzle-orm/d1', () => ({
  drizzle: mocks.mockDrizzle,
}));

describe('getDb', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.drizzleInstances.length = 0;
    mocks.mockDrizzle.mockClear();
  });

  it('caches the client for the same D1 binding via WeakMap', async () => {
    const { getDb } = await import('@/db/index');
    const db = { name: 'test' } as unknown as D1Database;

    const first = getDb(db);
    const second = getDb(db);

    expect(first).toBe(second);
    expect(mocks.drizzleInstances).toHaveLength(1);
    expect(mocks.mockDrizzle).toHaveBeenCalledTimes(1);
  });

  it('passes the provided D1 binding into drizzle', async () => {
    const { getDb } = await import('@/db/index');
    const db = { id: 'db-1' } as unknown as D1Database;

    getDb(db);

    expect(mocks.mockDrizzle).toHaveBeenCalledWith(db, expect.objectContaining({ schema: expect.anything() }));
  });
});
