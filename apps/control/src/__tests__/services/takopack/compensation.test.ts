import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({
  getDb: vi.fn().mockReturnValue({
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}));

vi.mock('@/services/routing', () => ({
  deleteHostnameRouting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/utils/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/platform/providers/cloudflare/resources.ts', () => ({
  CloudflareResourceService: class {
    deleteResource = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@/platform/providers/cloudflare/wfp.ts', () => ({
  WFPService: class {
    deleteWorker = vi.fn().mockResolvedValue(undefined);
  },
}));

import {
  CompensationTracker,
  bestEffort,
  cleanupProvisionedResources,
  cleanupDeployedWorkers,
} from '@/services/takopack/compensation';

describe('CompensationTracker', () => {
  it('executes compensation steps in reverse order', async () => {
    const tracker = new CompensationTracker();
    const order: number[] = [];

    tracker.add('step-1', async () => { order.push(1); });
    tracker.add('step-2', async () => { order.push(2); });
    tracker.add('step-3', async () => { order.push(3); });

    await tracker.rollback();

    expect(order).toEqual([3, 2, 1]);
  });

  it('continues rollback even if a step fails', async () => {
    const tracker = new CompensationTracker();
    const order: number[] = [];

    tracker.add('step-1', async () => { order.push(1); });
    tracker.add('step-2', async () => { throw new Error('compensation error'); });
    tracker.add('step-3', async () => { order.push(3); });

    await tracker.rollback();

    // step-3 and step-1 should run; step-2 fails but doesn't block
    expect(order).toEqual([3, 1]);
  });

  it('handles empty tracker', async () => {
    const tracker = new CompensationTracker();
    await expect(tracker.rollback()).resolves.toBeUndefined();
  });
});

describe('bestEffort', () => {
  it('runs the function without throwing on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await bestEffort(fn, 'test-label');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('swallows errors without re-throwing', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(bestEffort(fn, 'test-label')).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('cleanupProvisionedResources', () => {
  it('attempts to clean up all provisioned resources', async () => {
    const env = {
      DB: {},
      CF_ACCOUNT_ID: 'test-account',
      CF_API_TOKEN: 'test-token',
    } as any;

    const resourcesResult = {
      d1: [{ binding: 'DB', id: 'cf-d1-1', name: 'd1-name', resourceId: 'res-d1', wasAdopted: false }],
      r2: [{ binding: 'STORAGE', name: 'r2-name', resourceId: 'res-r2', wasAdopted: false }],
      kv: [{ binding: 'KV', id: 'cf-kv-1', name: 'kv-name', resourceId: 'res-kv', wasAdopted: false }],
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
    };

    await expect(cleanupProvisionedResources(env, resourcesResult)).resolves.toBeUndefined();
  });

  it('handles empty resource results', async () => {
    const env = { DB: {}, CF_ACCOUNT_ID: 'a', CF_API_TOKEN: 't' } as any;
    const result = {
      d1: [],
      r2: [],
      kv: [],
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
    };
    await expect(cleanupProvisionedResources(env, result)).resolves.toBeUndefined();
  });
});

describe('cleanupDeployedWorkers', () => {
  it('attempts to clean up deployed workers', async () => {
    const env = {
      DB: {},
      CF_ACCOUNT_ID: 'test-account',
      CF_API_TOKEN: 'test-token',
    } as any;

    const workers = [{
      manifestWorkerName: 'api',
      workerId: 'w-1',
      workerName: 'worker-w1',
      artifactRef: 'artifact-ref-1',
      slug: 'test-api-w1',
      hostname: 'test-api-w1.app.test.takos.jp',
    }];

    await expect(cleanupDeployedWorkers(env, workers)).resolves.toBeUndefined();
  });

  it('handles empty worker list', async () => {
    const env = { DB: {}, CF_ACCOUNT_ID: 'a', CF_API_TOKEN: 't' } as any;
    await expect(cleanupDeployedWorkers(env, [])).resolves.toBeUndefined();
  });
});
