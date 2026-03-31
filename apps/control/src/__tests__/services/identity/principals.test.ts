import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals } from 'jsr:@std/assert';

function createMockDrizzleDb() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    get: getMock,
  };
  return {
    select: () => chain,
    _: { get: getMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  resolveUserPrincipalId,
  resolveActorPrincipalId,
  getPrincipalById,
} from '@/services/identity/principals';


  
    Deno.test('principals service (Account-backed) - resolveUserPrincipalId - returns the account id when the user exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({ id: 'user-1' })) as any;

      const result = await resolveUserPrincipalId({} as D1Database, 'user-1');
      assertEquals(result, 'user-1');
})
    Deno.test('principals service (Account-backed) - resolveUserPrincipalId - returns null when the user is not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const result = await resolveUserPrincipalId({} as D1Database, 'nonexistent');
      assertEquals(result, null);
})
    Deno.test('principals service (Account-backed) - resolveUserPrincipalId - returns null when the row has a falsy id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({ id: '' })) as any;

      const result = await resolveUserPrincipalId({} as D1Database, 'user-1');
      assertEquals(result, null);
})  
  
    Deno.test('principals service (Account-backed) - resolveActorPrincipalId - returns the account id when the actor exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({ id: 'actor-1' })) as any;

      const result = await resolveActorPrincipalId({} as D1Database, 'actor-1');
      assertEquals(result, 'actor-1');
})
    Deno.test('principals service (Account-backed) - resolveActorPrincipalId - returns null when the actor is not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const result = await resolveActorPrincipalId({} as D1Database, 'nonexistent');
      assertEquals(result, null);
})  
  
    Deno.test('principals service (Account-backed) - getPrincipalById - returns a mapped Principal when the account exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'user-1',
        type: 'user',
        name: 'Test User',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      })) as any;

      const result = await getPrincipalById({} as D1Database, 'user-1');
      assertEquals(result, {
        id: 'user-1',
        type: 'user',
        display_name: 'Test User',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      });
})
    Deno.test('principals service (Account-backed) - getPrincipalById - returns null when account does not exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const result = await getPrincipalById({} as D1Database, 'nonexistent');
      assertEquals(result, null);
})
    Deno.test('principals service (Account-backed) - getPrincipalById - normalizes unknown type to service', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'svc-1',
        type: 'unknown_type',
        name: 'Service',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const result = await getPrincipalById({} as D1Database, 'svc-1');
      assertEquals(result?.type, 'service');
})
    Deno.test('principals service (Account-backed) - getPrincipalById - normalizes null type to service', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'svc-2',
        type: null,
        name: 'Null Type',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const result = await getPrincipalById({} as D1Database, 'svc-2');
      assertEquals(result?.type, 'service');
})
    Deno.test('principals service (Account-backed) - getPrincipalById - maps known principal kinds correctly', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const knownKinds = ['user', 'space_agent', 'service', 'system', 'tenant_worker'];

      for (const kind of knownKinds) {
        db._.get = (async () => ({
          id: `test-${kind}`,
          type: kind,
          name: `Test ${kind}`,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        })) as any;

        const result = await getPrincipalById({} as D1Database, `test-${kind}`);
        assertEquals(result?.type, kind);
      }
})  