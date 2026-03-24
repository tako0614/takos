import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  upsertManagedMcpServer: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/platform/mcp', () => ({
  upsertManagedMcpServer: mocks.upsertManagedMcpServer,
}));

import { BundleManagedMcpService } from '@/services/takopack/tools';

function createService(): BundleManagedMcpService {
  return new BundleManagedMcpService(createMockEnv() as unknown as Env);
}

/**
 * Build a Drizzle-chainable mock: db.select({...}).from(table).where(...).get()
 * Each call to the returned select() consumes the next value from `results`.
 */
function makeDrizzleDb(results: unknown[]) {
  let callIndex = 0;
  return {
    select: vi.fn(() => {
      const idx = callIndex++;
      const value = idx < results.length ? results[idx] : undefined;
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        get: vi.fn(async () => value),
        all: vi.fn(async () => (Array.isArray(value) ? value : value ? [value] : [])),
      };
      return chain;
    }),
  };
}

describe('BundleManagedMcpService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers managed takopack MCP servers for deployed workers', async () => {
    // Current path resolves the worker summary in one query.
    mocks.getDb.mockReturnValue(makeDrizzleDb([
      { id: 'worker-1', hostname: 'worker-1.example.workers.dev' },
    ]));

    const service = createService();
    await service.registerManagedMcpServer('ws-1', 'tp-1', 'lineage-1234', {
      name: 'notify_event',
      transport: 'streamable-http',
      worker: 'worker-1',
      endpoint: 'main-http',
      path: '/mcp',
    });

    expect(mocks.upsertManagedMcpServer).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      spaceId: 'ws-1',
      bundleDeploymentId: 'tp-1',
      sourceType: 'bundle_deployment',
      name: 'notify_event_lineage1',
      url: 'https://worker-1.example.workers.dev/mcp',
      serviceId: 'worker-1',
    });
  });

  it('throws when worker hostname is unavailable for managed MCP server registration', async () => {
    // Current path resolves the worker summary in one query.
    mocks.getDb.mockReturnValue(makeDrizzleDb([
      { id: 'worker-1', hostname: null },
    ]));

    const service = createService();
    await expect(service.registerManagedMcpServer('ws-1', 'tp-1', 'lineage-1234', {
      name: 'notify_event_mcp',
      transport: 'streamable-http',
      worker: 'worker-1',
      endpoint: 'main-http',
      path: '/mcp',
    })).rejects.toThrow('Worker hostname not available');
  });
});
