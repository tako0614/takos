import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getResourceById: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/resources/store', () => ({
  getResourceById: mocks.getResourceById,
}));

import { buildBindingFromResource } from '@/services/resources/bindings';

describe('buildBindingFromResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when resource not found', async () => {
    mocks.getResourceById.mockResolvedValue(null);

    const result = await buildBindingFromResource({} as D1Database, 'res-1', 'MY_DB');
    expect(result).toBeNull();
  });

  it('returns null when resource is not active', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      type: 'd1',
      status: 'deleting',
      cf_id: 'cf-123',
      cf_name: 'my-db',
    });

    const result = await buildBindingFromResource({} as D1Database, 'res-1', 'MY_DB');
    expect(result).toBeNull();
  });

  it('builds D1 binding', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      type: 'd1',
      status: 'active',
      cf_id: 'cf-d1-123',
      cf_name: 'my-d1-db',
    });

    const result = await buildBindingFromResource({} as D1Database, 'res-1', 'MY_DB');

    expect(result).toEqual({
      type: 'd1',
      name: 'MY_DB',
      id: 'cf-d1-123',
    });
  });

  it('builds R2 binding', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      type: 'r2',
      status: 'active',
      cf_id: null,
      cf_name: 'my-bucket',
    });

    const result = await buildBindingFromResource({} as D1Database, 'res-1', 'MY_BUCKET');

    expect(result).toEqual({
      type: 'r2',
      name: 'MY_BUCKET',
      bucket_name: 'my-bucket',
    });
  });

  it('builds KV binding', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      type: 'kv',
      status: 'active',
      cf_id: 'kv-namespace-id',
      cf_name: 'my-kv',
    });

    const result = await buildBindingFromResource({} as D1Database, 'res-1', 'MY_KV');

    expect(result).toEqual({
      type: 'kv',
      name: 'MY_KV',
      namespace_id: 'kv-namespace-id',
    });
  });

  it('builds Vectorize binding', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      type: 'vectorize',
      status: 'active',
      cf_id: null,
      cf_name: 'my-vectorize-index',
    });

    const result = await buildBindingFromResource({} as D1Database, 'res-1', 'MY_VECTORS');

    expect(result).toEqual({
      type: 'vectorize',
      name: 'MY_VECTORS',
      index_name: 'my-vectorize-index',
    });
  });

  it('returns null for unknown resource type', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      type: 'unknown',
      status: 'active',
      cf_id: null,
      cf_name: 'test',
    });

    const result = await buildBindingFromResource({} as D1Database, 'res-1', 'MY_BINDING');
    expect(result).toBeNull();
  });

  it('handles null cf_id and cf_name', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      type: 'd1',
      status: 'active',
      cf_id: null,
      cf_name: null,
    });

    const result = await buildBindingFromResource({} as D1Database, 'res-1', 'MY_DB');

    expect(result).toEqual({
      type: 'd1',
      name: 'MY_DB',
      id: undefined,
    });
  });
});
