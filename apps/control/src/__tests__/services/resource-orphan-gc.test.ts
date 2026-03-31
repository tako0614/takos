import type * as DbModule from '@/db';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  deleteManagedResource: ((..._args: any[]) => undefined) as any,
  orphanedResources: [] as Array<{
    id: string;
    type: string;
    providerName: string | null;
    providerResourceId: string | null;
    providerResourceName: string | null;
  }>,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources/lifecycle'
import { gcOrphanedResources } from '@/services/maintenance/resource-orphan-gc';


  Deno.test('gcOrphanedResources - reclaims cloudflare and portable orphaned resources through the shared lifecycle path', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => ({
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  all: async () => mocks.orphanedResources,
                };
              },
            };
          },
        };
      },
      delete() {
        return {
          where() {
            return Promise.resolve();
          },
        };
      },
    })) as any;
    mocks.deleteManagedResource = (async () => undefined) as any;
  mocks.orphanedResources = [
      {
        id: 'res-cf',
        type: 'd1',
        providerName: 'cloudflare',
        providerResourceId: 'cf-db',
        providerResourceName: 'cf-db',
      },
      {
        id: 'res-portable',
        type: 'kv',
        providerName: 'aws',
        providerResourceId: 'portable-kv',
        providerResourceName: 'portable-kv',
      },
    ];

    const result = await gcOrphanedResources({
      DB: {} as never,
      CF_ACCOUNT_ID: 'account',
      CF_API_TOKEN: 'token',
      WFP_DISPATCH_NAMESPACE: 'dispatch',
    });

    assertSpyCalls(mocks.deleteManagedResource, 2);
    assertSpyCallArgs(mocks.deleteManagedResource, 0, [expect.anything(), {
      type: 'd1',
      providerName: 'cloudflare',
      providerResourceId: 'cf-db',
      providerResourceName: 'cf-db',
    }]);
    assertSpyCallArgs(mocks.deleteManagedResource, 1, [expect.anything(), {
      type: 'kv',
      providerName: 'aws',
      providerResourceId: 'portable-kv',
      providerResourceName: 'portable-kv',
    }]);
    assertEquals(result.deleted, 2);
    assertEquals(result.failed, 0);
})