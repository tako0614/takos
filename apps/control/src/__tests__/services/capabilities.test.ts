import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  resolveActorPrincipalId: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/principals'
import { resolveAllowedCapabilities } from '@/services/platform/capabilities';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    get: getMock,
  };
  return {
    select: () => chain,
    _: { get: getMock },
  };
}


  Deno.test('capabilities service - derives restricted egress posture from the workspace record', async () => {
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;
    mocks.resolveActorPrincipalId = (async () => 'principal-1') as any;

    drizzle._.get
       = (async () => ({ ownerAccountId: 'owner-2' })) as any
       = (async () => ({ role: 'editor' })) as any
       = (async () => ({ securityPosture: 'restricted_egress' })) as any;

    const result = await resolveAllowedCapabilities({
      db: {} as D1Database,
      spaceId: 'ws-1',
      userId: 'user-1',
    });

    assertEquals(result.ctx.role, 'editor');
    assertEquals(result.ctx.securityPosture, 'restricted_egress');
    assertEquals(result.allowed.has('egress.http'), false);
})
  Deno.test('capabilities service - applies an admin floor when requested for agent execution', async () => {
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;
    mocks.resolveActorPrincipalId = (async () => 'principal-1') as any;

    drizzle._.get
       = (async () => ({ ownerAccountId: 'owner-2' })) as any
       = (async () => ({ role: 'viewer' })) as any
       = (async () => ({ securityPosture: 'standard' })) as any;

    const result = await resolveAllowedCapabilities({
      db: {} as D1Database,
      spaceId: 'ws-1',
      userId: 'user-1',
      minimumRole: 'admin',
    });

    assertEquals(result.ctx.role, 'admin');
    assertEquals(result.allowed.has('repo.write'), true);
    assertEquals(result.allowed.has('storage.write'), true);
    assertEquals(result.allowed.has('egress.http'), true);
})
  Deno.test('capabilities service - preserves owner when the resolved role exceeds the admin floor', async () => {
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;
    mocks.resolveActorPrincipalId = (async () => 'principal-owner') as any;

    drizzle._.get
       = (async () => ({ ownerAccountId: 'principal-owner' })) as any
       = (async () => ({ securityPosture: 'standard' })) as any;

    const result = await resolveAllowedCapabilities({
      db: {} as D1Database,
      spaceId: 'ws-1',
      userId: 'user-owner',
      minimumRole: 'admin',
    });

    assertEquals(result.ctx.role, 'owner');
})