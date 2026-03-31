import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@/db';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  deleteManagedResource: vi.fn(),
  orphanedResources: [] as Array<{
    id: string;
    type: string;
    providerName: string | null;
    providerResourceId: string | null;
    providerResourceName: string | null;
  }>,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/resources/lifecycle', () => ({
  deleteManagedResource: mocks.deleteManagedResource,
}));

import { gcOrphanedResources } from '@/services/maintenance/resource-orphan-gc';

describe('gcOrphanedResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue({
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
    });
    mocks.deleteManagedResource.mockResolvedValue(undefined);
  });

  it('reclaims cloudflare and portable orphaned resources through the shared lifecycle path', async () => {
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

    expect(mocks.deleteManagedResource).toHaveBeenCalledTimes(2);
    expect(mocks.deleteManagedResource).toHaveBeenNthCalledWith(1, expect.anything(), {
      type: 'd1',
      providerName: 'cloudflare',
      providerResourceId: 'cf-db',
      providerResourceName: 'cf-db',
    });
    expect(mocks.deleteManagedResource).toHaveBeenNthCalledWith(2, expect.anything(), {
      type: 'kv',
      providerName: 'aws',
      providerResourceId: 'portable-kv',
      providerResourceName: 'portable-kv',
    });
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);
  });
});
