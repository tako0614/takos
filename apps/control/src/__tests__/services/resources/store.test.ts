import type { D1Database } from '@cloudflare/workers-types';
import type * as DbModule from '@/db';
import type * as SharedUtilsModule from '@/shared/utils';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  now: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    leftJoin: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    selectDistinct: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock },
  };
}


  Deno.test('getResourceById - returns null when resource not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const { getResourceById } = await import('@/services/resources/store');
    const result = await getResourceById({} as D1Database, 'nonexistent');

    assertEquals(result, null);
})
  Deno.test('getResourceById - returns mapped resource when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: 'space-1',
      name: 'my-db',
      type: 'd1',
      status: 'active',
      providerResourceId: 'cf-123',
      providerResourceName: 'my-d1-db',
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const { getResourceById } = await import('@/services/resources/store');
    const result = await getResourceById({} as D1Database, 'res-1');

    assertNotEquals(result, null);
    assertEquals(result!.id, 'res-1');
    assertEquals(result!.owner_id, 'user-1');
    assertEquals(result!.name, 'my-db');
    assertEquals(result!.type, 'd1');
    assertEquals(result!.capability, 'sql');
    assertEquals(result!.implementation, 'd1');
    assertEquals(result!.status, 'active');
})

  Deno.test('getResourceByName - returns null when resource not found by name', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const { getResourceByName } = await import('@/services/resources/store');
    const result = await getResourceByName({} as D1Database, 'user-1', 'nonexistent');

    assertEquals(result, null);
})
  Deno.test('getResourceByName - returns resource with _internal_id when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: 'space-1',
      name: 'my-db',
      type: 'd1',
      status: 'active',
      providerResourceId: 'cf-123',
      providerResourceName: 'my-d1-db',
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const { getResourceByName } = await import('@/services/resources/store');
    const result = await getResourceByName({} as D1Database, 'user-1', 'my-db');

    assertNotEquals(result, null);
    assertEquals(result!._internal_id, 'res-1');
    assertEquals(result!.name, 'my-db');
    assertEquals(result!.type, 'd1');
})

  Deno.test('updateResourceMetadata - returns null when no updates provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-02T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    const { updateResourceMetadata } = await import('@/services/resources/store');
    const result = await updateResourceMetadata({} as D1Database, 'res-1', {});

    assertEquals(result, null);
})
  Deno.test('updateResourceMetadata - updates name when provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-02T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: null,
      name: 'new-name',
      type: 'd1',
      status: 'active',
      providerResourceId: null,
      providerResourceName: null,
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const { updateResourceMetadata } = await import('@/services/resources/store');
    const result = await updateResourceMetadata({} as D1Database, 'res-1', { name: 'new-name' });

    assert(drizzle.update.calls.length > 0);
    assertNotEquals(result, null);
    assertEquals(result!.name, 'new-name');
})
  Deno.test('updateResourceMetadata - serializes config and metadata as JSON', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-02T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: null,
      name: 'test',
      type: 'd1',
      status: 'active',
      providerResourceId: null,
      providerResourceName: null,
      config: '{"key":"value"}',
      metadata: '{"meta":"data"}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const { updateResourceMetadata } = await import('@/services/resources/store');
    await updateResourceMetadata({} as D1Database, 'res-1', {
      config: { key: 'value' },
      metadata: { meta: 'data' },
    });

    assert(drizzle.update.calls.length > 0);
    const setCall = drizzle._.run.calls;
    assert(setCall !== undefined);
})

  Deno.test('markResourceDeleting - updates resource status to deleting', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-02T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    const { markResourceDeleting } = await import('@/services/resources/store');
    await markResourceDeleting({} as D1Database, 'res-1');

    assert(drizzle.update.calls.length > 0);
})

  Deno.test('deleteResource - deletes a resource by id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    const { deleteResource } = await import('@/services/resources/store');
    await deleteResource({} as D1Database, 'res-1');

    assert(drizzle.delete.calls.length > 0);
})

  Deno.test('insertResource - inserts a resource and returns it', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: 'space-1',
      name: 'my-new-db',
      type: 'd1',
      status: 'active',
      providerResourceId: 'cf-123',
      providerResourceName: 'my-d1-db',
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const { insertResource } = await import('@/services/resources/store');
    const result = await insertResource({} as D1Database, {
      id: 'res-1',
      owner_id: 'user-1',
      name: 'my-new-db',
      type: 'd1',
      status: 'active',
      provider_resource_id: 'cf-123',
      provider_resource_name: 'my-d1-db',
      config: {},
      space_id: 'space-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    assert(drizzle.insert.calls.length > 0);
    assertNotEquals(result, null);
    assertEquals(result!.name, 'my-new-db');
})

  Deno.test('insertFailedResource - inserts a resource with failed status', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    const { insertFailedResource } = await import('@/services/resources/store');
    await insertFailedResource({} as D1Database, {
      id: 'res-1',
      owner_id: 'user-1',
      name: 'failed-db',
      type: 'd1',
      provider_resource_name: 'my-d1-db',
      config: { error: 'provisioning failed' },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    assert(drizzle.insert.calls.length > 0);
})