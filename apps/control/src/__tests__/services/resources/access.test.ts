import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  getResourceById: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources/store'
import { checkResourceAccess, canAccessResource } from '@/services/resources/access';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    leftJoin: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}


  Deno.test('checkResourceAccess - returns true when user has direct access', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    // First call: memberships
    drizzle._.all = (async () => []) as any;
    // Second call: access check
    drizzle._.get = (async () => ({ permission: 'read' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1');
    assertEquals(result, true);
})
  Deno.test('checkResourceAccess - returns false when no access found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    drizzle._.get = (async () => null) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1');
    assertEquals(result, false);
})
  Deno.test('checkResourceAccess - checks required permissions', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    drizzle._.get = (async () => ({ permission: 'read' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1', ['write']);
    assertEquals(result, false);
})
  Deno.test('checkResourceAccess - passes when user has required permission', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    drizzle._.get = (async () => ({ permission: 'admin' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1', ['admin']);
    assertEquals(result, true);
})
  Deno.test('checkResourceAccess - includes workspace memberships in access check', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [{ accountId: 'team-1' }]) as any;
    drizzle._.get = (async () => ({ permission: 'write' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1', ['write']);
    assertEquals(result, true);
})

  Deno.test('canAccessResource - returns canAccess: false when resource not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getResourceById = (async () => null) as any;

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-1');
    assertEquals(result.canAccess, false);
    assertEquals(result.isOwner, false);
})
  Deno.test('canAccessResource - returns isOwner: true for resource owner', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getResourceById = (async () => ({
      id: 'res-1',
      owner_id: 'user-1',
      type: 'd1',
      status: 'active',
    })) as any;

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-1');
    assertEquals(result.canAccess, true);
    assertEquals(result.isOwner, true);
    assertEquals(result.permission, 'admin');
})
  Deno.test('canAccessResource - checks access grants for non-owner', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getResourceById = (async () => ({
      id: 'res-1',
      owner_id: 'other-user',
      type: 'd1',
      status: 'active',
    })) as any;

    const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any; // memberships
    drizzle._.get = (async () => ({ permission: 'write' })) as any; // access
    mocks.getDb = (() => drizzle) as any;

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-2');
    assertEquals(result.canAccess, true);
    assertEquals(result.isOwner, false);
    assertEquals(result.permission, 'write');
})
  Deno.test('canAccessResource - checks required permissions for non-owner', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getResourceById = (async () => ({
      id: 'res-1',
      owner_id: 'other-user',
      type: 'd1',
      status: 'active',
    })) as any;

    const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    drizzle._.get = (async () => ({ permission: 'read' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-2', ['admin']);
    assertEquals(result.canAccess, false);
    assertEquals(result.isOwner, false);
    assertEquals(result.permission, 'read');
})
  Deno.test('canAccessResource - returns canAccess: false when no access grants exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getResourceById = (async () => ({
      id: 'res-1',
      owner_id: 'other-user',
      type: 'd1',
      status: 'active',
    })) as any;

    const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    drizzle._.get = (async () => null) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-2');
    assertEquals(result.canAccess, false);
    assertEquals(result.isOwner, false);
})