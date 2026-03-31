import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: (() => 'worker-new'),
  now: (() => '2026-03-24T00:00:00.000Z'),
  resolveActorPrincipalId: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/principals'
import {
  slugifyWorkerName,
  countServicesInSpace,
  listServicesForSpace,
  getServiceById,
  createService,
  deleteService,
  listServicesForUser,
  getServiceForUser,
  resolveServiceReferenceRecord,
  WORKSPACE_WORKER_LIMITS,
} from '@/services/platform/workers';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    innerJoin: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock },
  };
}

const makeServiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'w1',
  accountId: 'ws-1',
  workerType: 'app',
  status: 'deployed',
  config: null,
  hostname: 'my-app.takos.dev',
  routeRef: 'worker-w1',
  slug: 'my-app',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});


  Deno.test('slugifyWorkerName - lowercases and replaces invalid chars', () => {
  assertEquals(slugifyWorkerName('My App Name!'), 'my-app-name');
})
  Deno.test('slugifyWorkerName - removes leading/trailing hyphens', () => {
  assertEquals(slugifyWorkerName('-test-'), 'test');
})
  Deno.test('slugifyWorkerName - truncates to 32 characters', () => {
  const long = 'a'.repeat(50);
    assert(slugifyWorkerName(long).length <= 32);
})
  Deno.test('slugifyWorkerName - handles empty string', () => {
  assertEquals(slugifyWorkerName(''), '');
})

  Deno.test('WORKSPACE_WORKER_LIMITS - has a maxWorkers limit', () => {
  assertEquals(WORKSPACE_WORKER_LIMITS.maxWorkers, 100);
})

  Deno.test('countServicesInSpace - returns count from DB', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ count: 5 })) as any;
    mocks.getDb = (() => drizzle) as any;

    const count = await countServicesInSpace({} as D1Database, 'ws-1');
    assertEquals(count, 5);
})
  Deno.test('countServicesInSpace - returns 0 when no workers', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const count = await countServicesInSpace({} as D1Database, 'ws-1');
    assertEquals(count, 0);
})

  Deno.test('listServicesForSpace - returns empty array when no workers', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    mocks.getDb = (() => drizzle) as any;

    const workers = await listServicesForSpace({} as D1Database, 'ws-1');
    assertEquals(workers, []);
})
  Deno.test('listServicesForSpace - returns mapped workers', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [makeServiceRow()]) as any;
    mocks.getDb = (() => drizzle) as any;

    const workers = await listServicesForSpace({} as D1Database, 'ws-1');
    assertEquals(workers.length, 1);
    assertEquals(workers[0].id, 'w1');
    assertEquals(workers[0].space_id, 'ws-1');
    assertEquals(workers[0].service_type, 'app');
    assertEquals(workers[0].status, 'deployed');
    assertEquals(workers[0].slug, 'my-app');
})

  Deno.test('getServiceById - returns null when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const worker = await getServiceById({} as D1Database, 'nonexistent');
    assertEquals(worker, null);
})
  Deno.test('getServiceById - returns mapped worker when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => makeServiceRow()) as any;
    mocks.getDb = (() => drizzle) as any;

    const worker = await getServiceById({} as D1Database, 'w1');
    assertNotEquals(worker, null);
    assertEquals(worker!.id, 'w1');
    assertEquals(worker!.hostname, 'my-app.takos.dev');
    assertEquals(worker!.service_name, 'worker-w1');
})

  Deno.test('createService - creates worker with generated id and hostname', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => makeServiceRow({ id: 'worker-new' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await createService({} as D1Database, {
      spaceId: 'ws-1',
      workerType: 'app',
      slug: 'my-app',
      platformDomain: 'takos.dev',
    });

    assertEquals(result.id, 'worker-new');
    assertEquals(result.slug, 'my-app');
    assertEquals(result.hostname, 'my-app.takos.dev');
    assert(drizzle.insert.calls.length > 0);
})
  Deno.test('createService - generates slug from id when not provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => makeServiceRow({ id: 'worker-new' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await createService({} as D1Database, {
      spaceId: 'ws-1',
      workerType: 'service',
      platformDomain: 'takos.dev',
    });

    assertEquals(result.slug, 'worker-new');
})

  Deno.test('deleteService - deletes worker by id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    await deleteService({} as D1Database, 'w1');
    assert(drizzle.delete.calls.length > 0);
})

  Deno.test('listServicesForUser - returns empty when principal not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resolveActorPrincipalId = (async () => null) as any;

    const result = await listServicesForUser({} as D1Database, 'user-1');
    assertEquals(result, []);
})
  Deno.test('listServicesForUser - returns empty when no memberships', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resolveActorPrincipalId = (async () => 'principal-1') as any;
    const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any; // memberships
    mocks.getDb = (() => drizzle) as any;

    const result = await listServicesForUser({} as D1Database, 'user-1');
    assertEquals(result, []);
})

  Deno.test('resolveServiceReferenceRecord - returns null for empty reference', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await resolveServiceReferenceRecord({} as D1Database, 'ws-1', '');
    assertEquals(result, null);
})
  Deno.test('resolveServiceReferenceRecord - returns null for whitespace-only reference', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await resolveServiceReferenceRecord({} as D1Database, 'ws-1', '   ');
    assertEquals(result, null);
})
  Deno.test('resolveServiceReferenceRecord - returns worker when found by id/name/slug', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'w1',
      accountId: 'ws-1',
      workerType: 'app',
      status: 'deployed',
      hostname: 'my-app.takos.dev',
      routeRef: 'worker-w1',
      slug: 'my-app',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await resolveServiceReferenceRecord({} as D1Database, 'ws-1', 'my-app');
    assertNotEquals(result, null);
    assertEquals(result!.id, 'w1');
})