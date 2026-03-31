import { CommonEnvOrchestrator } from '@/services/common-env/orchestrator';
import type { CommonEnvReconcileJobStore } from '@/services/common-env/reconcile-jobs';
import type { CommonEnvReconciler } from '@/services/common-env/reconciler';
import type { Env } from '@/shared/types';

// [Deno] vi.mock removed - manually stub imports from '@/services/common-env/repository'
import * as repositoryModule from '@/services/common-env/repository';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

function createMockEnv(): Pick<Env, 'DB'> {
  return { DB: {} as Env['DB'] };
}

function createMockJobs(): CommonEnvReconcileJobStore & { enqueue: ReturnType<typeof vi.fn> } {
  return {
    enqueue: (async () => 'job-1'),
    enqueueService: (async () => 'job-1'),
    enqueueForWorkers: (async () => undefined),
    enqueueForServices: (async () => undefined),
    listRunnable: (async () => []),
    markProcessing: (async () => true),
    markCompleted: (async () => undefined),
    markRetry: (async () => undefined),
    recoverStaleProcessing: (async () => 0),
    enqueuePeriodicDriftSweep: (async () => 0),
  } as unknown as CommonEnvReconcileJobStore & { enqueue: ReturnType<typeof vi.fn> };
}

function createMockReconciler(): CommonEnvReconciler {
  return {
    reconcileServiceCommonEnv: (async () => undefined),
    markServiceLinksApplyFailed: (async () => undefined),
  } as unknown as CommonEnvReconciler;
}


  let env: Pick<Env, 'DB'>;
  let jobs: ReturnType<typeof createMockJobs>;
  let reconciler: ReturnType<typeof createMockReconciler>;
  let orchestrator: CommonEnvOrchestrator;
  
    Deno.test('CommonEnvOrchestrator - enqueueServiceReconcile - delegates to jobs.enqueueService', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  await orchestrator.enqueueServiceReconcile({
        spaceId: 'space-1',
        serviceId: 'worker-1',
        targetKeys: ['MY_VAR'],
        trigger: 'workspace_env_put',
      });

      assertSpyCallArgs(jobs.enqueueService, 0, [{
        spaceId: 'space-1',
        serviceId: 'worker-1',
        targetKeys: ['MY_VAR'],
        trigger: 'workspace_env_put',
      }]);
})  
  
    Deno.test('CommonEnvOrchestrator - reconcileServicesForEnvKey - finds linked services and enqueues jobs for them', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  (repositoryModule.listServiceIdsLinkedToEnvKey as ReturnType<typeof vi.fn>) = (async () => ['w-1', 'w-2']) as any;

      await orchestrator.reconcileServicesForEnvKey('space-1', 'my_var', 'workspace_env_put');

      assertSpyCallArgs(repositoryModule.listServiceIdsLinkedToEnvKey, 0, [env, 'space-1', 'MY_VAR']);
      assertSpyCallArgs(jobs.enqueueForServices, 0, [{
        spaceId: 'space-1',
        serviceIds: ['w-1', 'w-2'],
        targetKeys: ['MY_VAR'],
        trigger: 'workspace_env_put',
      }]);
})
    Deno.test('CommonEnvOrchestrator - reconcileServicesForEnvKey - uses default trigger when not specified', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  (repositoryModule.listServiceIdsLinkedToEnvKey as ReturnType<typeof vi.fn>) = (async () => ['w-1']) as any;

      await orchestrator.reconcileServicesForEnvKey('space-1', 'my_var');

      assertSpyCallArgs(jobs.enqueueForServices, 0, [
        ({ trigger: 'workspace_env_put' })
      ]);
})  
  
    Deno.test('CommonEnvOrchestrator - reconcileServices - enqueues for specified services with normalized keys', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  await orchestrator.reconcileServices({
        spaceId: 'space-1',
        serviceIds: ['w-1', 'w-2'],
        keys: ['my_var', 'another_var'],
        trigger: 'manual_links_set',
      });

      assertSpyCallArgs(jobs.enqueueForServices, 0, [{
        spaceId: 'space-1',
        serviceIds: ['w-1', 'w-2'],
        targetKeys: ['MY_VAR', 'ANOTHER_VAR'],
        trigger: 'manual_links_set',
      }]);
})
    Deno.test('CommonEnvOrchestrator - reconcileServices - defaults trigger to bundle_required_links', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  await orchestrator.reconcileServices({
        spaceId: 'space-1',
        serviceIds: ['w-1'],
      });

      assertSpyCallArgs(jobs.enqueueForServices, 0, [
        ({ trigger: 'bundle_required_links' })
      ]);
})
    Deno.test('CommonEnvOrchestrator - reconcileServices - passes undefined targetKeys when keys not specified', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  await orchestrator.reconcileServices({
        spaceId: 'space-1',
        serviceIds: ['w-1'],
      });

      assertSpyCallArgs(jobs.enqueueForServices, 0, [
        ({ targetKeys: undefined })
      ]);
})  
  
    Deno.test('CommonEnvOrchestrator - processReconcileJobs - recovers stale and processes runnable jobs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>) = (async () => 2) as any;
      (jobs.listRunnable as ReturnType<typeof vi.fn>) = (async () => [
        { id: 'j-1', accountId: 'space-1', serviceId: 'w-1', workerId: 'w-1', targetKeysJson: null, trigger: 'workspace_env_put', attempts: 0 },
      ]) as any;

      const result = await orchestrator.processReconcileJobs(50);

      assertSpyCallArgs(jobs.recoverStaleProcessing, 0, [50]);
      assertSpyCallArgs(jobs.markProcessing, 0, ['j-1']);
      assert(reconciler.reconcileServiceCommonEnv.calls.length > 0);
      assertSpyCallArgs(jobs.markCompleted, 0, ['j-1']);
      assertEquals(result.processed, 3); // 1 runnable + 2 stale
      assertEquals(result.completed, 1);
      assertEquals(result.retried, 2);
})
    Deno.test('CommonEnvOrchestrator - processReconcileJobs - marks retry on reconciler failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  const error = new Error('reconcile failed');
      (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>) = (async () => 0) as any;
      (jobs.listRunnable as ReturnType<typeof vi.fn>) = (async () => [
        { id: 'j-1', accountId: 'space-1', serviceId: 'w-1', workerId: 'w-1', targetKeysJson: null, trigger: 'workspace_env_put', attempts: 1 },
      ]) as any;
      (reconciler.reconcileServiceCommonEnv as ReturnType<typeof vi.fn>) = (async () => { throw error; }) as any;

      const result = await orchestrator.processReconcileJobs(50);

      assert(reconciler.markServiceLinksApplyFailed.calls.length > 0);
      assertSpyCallArgs(jobs.markRetry, 0, ['j-1', 1, error]);
      assertEquals(result.completed, 0);
      assertEquals(result.retried, 1);
})
    Deno.test('CommonEnvOrchestrator - processReconcileJobs - skips jobs that fail to claim', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>) = (async () => 0) as any;
      (jobs.listRunnable as ReturnType<typeof vi.fn>) = (async () => [
        { id: 'j-1', accountId: 'space-1', serviceId: 'w-1', workerId: 'w-1', targetKeysJson: null, trigger: 'workspace_env_put', attempts: 0 },
      ]) as any;
      (jobs.markProcessing as ReturnType<typeof vi.fn>) = (async () => false) as any;

      const result = await orchestrator.processReconcileJobs(50);

      assertSpyCalls(reconciler.reconcileServiceCommonEnv, 0);
      assertEquals(result.completed, 0);
})
    Deno.test('CommonEnvOrchestrator - processReconcileJobs - parses targetKeys from JSON', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>) = (async () => 0) as any;
      (jobs.listRunnable as ReturnType<typeof vi.fn>) = (async () => [
        {
          id: 'j-1',
          accountId: 'space-1',
          serviceId: 'w-1',
          workerId: 'w-1',
          targetKeysJson: '["MY_VAR","ANOTHER"]',
          trigger: 'workspace_env_put',
          attempts: 0,
        },
      ]) as any;

      await orchestrator.processReconcileJobs(50);

      assertSpyCallArgs(reconciler.reconcileServiceCommonEnv, 0, [
        'space-1',
        'w-1',
        ({
          targetKeys: /* expect.any(Set) */ {} as any,
        })
      ]);
})  
  
    Deno.test('CommonEnvOrchestrator - enqueuePeriodicDriftSweep - recovers stale then enqueues drift sweep', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);
  (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>) = (async () => 1) as any;
      (jobs.enqueuePeriodicDriftSweep as ReturnType<typeof vi.fn>) = (async () => 5) as any;

      const result = await orchestrator.enqueuePeriodicDriftSweep(100);

      assertSpyCallArgs(jobs.recoverStaleProcessing, 0, [100]);
      assertSpyCallArgs(jobs.enqueuePeriodicDriftSweep, 0, [100]);
      assertEquals(result, 5);
})  