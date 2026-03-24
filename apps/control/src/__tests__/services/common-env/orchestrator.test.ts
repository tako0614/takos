import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommonEnvOrchestrator } from '@/services/common-env/orchestrator';
import type { CommonEnvRepository } from '@/services/common-env/repository';
import type { CommonEnvReconcileJobStore } from '@/services/common-env/reconcile-jobs';
import type { CommonEnvReconciler } from '@/services/common-env/reconciler';

function createMockRepo(): CommonEnvRepository {
  return {
    listServiceIdsLinkedToEnvKey: vi.fn().mockResolvedValue([]),
    listWorkerIdsLinkedToEnvKey: vi.fn().mockResolvedValue([]),
    listServiceLinks: vi.fn().mockResolvedValue([]),
    listWorkerLinks: vi.fn().mockResolvedValue([]),
    getWorker: vi.fn().mockResolvedValue(null),
    updateLinkRuntime: vi.fn().mockResolvedValue(undefined),
    listWorkspaceEnvRows: vi.fn().mockResolvedValue([]),
    listWorkspaceCommonEnvNames: vi.fn().mockResolvedValue([]),
  } as unknown as CommonEnvRepository;
}

function createMockJobs(): CommonEnvReconcileJobStore & { enqueue: ReturnType<typeof vi.fn> } {
  return {
    enqueue: vi.fn().mockResolvedValue('job-1'),
    enqueueService: vi.fn().mockResolvedValue('job-1'),
    enqueueForWorkers: vi.fn().mockResolvedValue(undefined),
    enqueueForServices: vi.fn().mockResolvedValue(undefined),
    listRunnable: vi.fn().mockResolvedValue([]),
    markProcessing: vi.fn().mockResolvedValue(true),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markRetry: vi.fn().mockResolvedValue(undefined),
    recoverStaleProcessing: vi.fn().mockResolvedValue(0),
    enqueuePeriodicDriftSweep: vi.fn().mockResolvedValue(0),
  } as unknown as CommonEnvReconcileJobStore & { enqueue: ReturnType<typeof vi.fn> };
}

function createMockReconciler(): CommonEnvReconciler {
  return {
    reconcileServiceCommonEnv: vi.fn().mockResolvedValue(undefined),
    markServiceLinksApplyFailed: vi.fn().mockResolvedValue(undefined),
    reconcileWorkerCommonEnv: vi.fn().mockResolvedValue(undefined),
    markWorkerLinksApplyFailed: vi.fn().mockResolvedValue(undefined),
  } as unknown as CommonEnvReconciler;
}

describe('CommonEnvOrchestrator', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let jobs: ReturnType<typeof createMockJobs>;
  let reconciler: ReturnType<typeof createMockReconciler>;
  let orchestrator: CommonEnvOrchestrator;

  beforeEach(() => {
    repo = createMockRepo();
    jobs = createMockJobs();
    reconciler = createMockReconciler();
    orchestrator = new CommonEnvOrchestrator(repo, jobs, reconciler);
  });

  describe('enqueueWorkerReconcile', () => {
    it('delegates to jobs.enqueue', async () => {
      await orchestrator.enqueueWorkerReconcile({
        spaceId: 'space-1',
        workerId: 'worker-1',
        targetKeys: ['MY_VAR'],
        trigger: 'workspace_env_put',
      });

      expect(jobs.enqueueService).toHaveBeenCalledWith({
        spaceId: 'space-1',
        serviceId: 'worker-1',
        targetKeys: ['MY_VAR'],
        trigger: 'workspace_env_put',
      });
    });
  });

  describe('reconcileWorkersForEnvKey', () => {
    it('finds linked workers and enqueues jobs for them', async () => {
      (repo.listServiceIdsLinkedToEnvKey as ReturnType<typeof vi.fn>).mockResolvedValue(['w-1', 'w-2']);

      await orchestrator.reconcileWorkersForEnvKey('space-1', 'my_var', 'workspace_env_put');

      expect(repo.listServiceIdsLinkedToEnvKey).toHaveBeenCalledWith('space-1', 'MY_VAR');
      expect(jobs.enqueueForServices).toHaveBeenCalledWith({
        spaceId: 'space-1',
        serviceIds: ['w-1', 'w-2'],
        targetKeys: ['MY_VAR'],
        trigger: 'workspace_env_put',
      });
    });

    it('uses default trigger when not specified', async () => {
      (repo.listServiceIdsLinkedToEnvKey as ReturnType<typeof vi.fn>).mockResolvedValue(['w-1']);

      await orchestrator.reconcileWorkersForEnvKey('space-1', 'my_var');

      expect(jobs.enqueueForServices).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: 'workspace_env_put' })
      );
    });
  });

  describe('reconcileWorkers', () => {
    it('enqueues for specified workers with normalized keys', async () => {
      await orchestrator.reconcileWorkers({
        spaceId: 'space-1',
        workerIds: ['w-1', 'w-2'],
        keys: ['my_var', 'another_var'],
        trigger: 'manual_links_set',
      });

      expect(jobs.enqueueForServices).toHaveBeenCalledWith({
        spaceId: 'space-1',
        serviceIds: ['w-1', 'w-2'],
        targetKeys: ['MY_VAR', 'ANOTHER_VAR'],
        trigger: 'manual_links_set',
      });
    });

    it('defaults trigger to bundle_required_links', async () => {
      await orchestrator.reconcileWorkers({
        spaceId: 'space-1',
        workerIds: ['w-1'],
      });

      expect(jobs.enqueueForServices).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: 'bundle_required_links' })
      );
    });

    it('passes undefined targetKeys when keys not specified', async () => {
      await orchestrator.reconcileWorkers({
        spaceId: 'space-1',
        workerIds: ['w-1'],
      });

      expect(jobs.enqueueForServices).toHaveBeenCalledWith(
        expect.objectContaining({ targetKeys: undefined })
      );
    });
  });

  describe('processReconcileJobs', () => {
    it('recovers stale and processes runnable jobs', async () => {
      (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>).mockResolvedValue(2);
      (jobs.listRunnable as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'j-1', accountId: 'space-1', serviceId: 'w-1', workerId: 'w-1', targetKeysJson: null, trigger: 'workspace_env_put', attempts: 0 },
      ]);

      const result = await orchestrator.processReconcileJobs(50);

      expect(jobs.recoverStaleProcessing).toHaveBeenCalledWith(50);
      expect(jobs.markProcessing).toHaveBeenCalledWith('j-1');
      expect(reconciler.reconcileServiceCommonEnv).toHaveBeenCalled();
      expect(jobs.markCompleted).toHaveBeenCalledWith('j-1');
      expect(result.processed).toBe(3); // 1 runnable + 2 stale
      expect(result.completed).toBe(1);
      expect(result.retried).toBe(2);
    });

    it('marks retry on reconciler failure', async () => {
      const error = new Error('reconcile failed');
      (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>).mockResolvedValue(0);
      (jobs.listRunnable as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'j-1', accountId: 'space-1', serviceId: 'w-1', workerId: 'w-1', targetKeysJson: null, trigger: 'workspace_env_put', attempts: 1 },
      ]);
      (reconciler.reconcileServiceCommonEnv as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const result = await orchestrator.processReconcileJobs(50);

      expect(reconciler.markServiceLinksApplyFailed).toHaveBeenCalled();
      expect(jobs.markRetry).toHaveBeenCalledWith('j-1', 1, error);
      expect(result.completed).toBe(0);
      expect(result.retried).toBe(1);
    });

    it('skips jobs that fail to claim', async () => {
      (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>).mockResolvedValue(0);
      (jobs.listRunnable as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'j-1', accountId: 'space-1', serviceId: 'w-1', workerId: 'w-1', targetKeysJson: null, trigger: 'workspace_env_put', attempts: 0 },
      ]);
      (jobs.markProcessing as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const result = await orchestrator.processReconcileJobs(50);

      expect(reconciler.reconcileServiceCommonEnv).not.toHaveBeenCalled();
      expect(result.completed).toBe(0);
    });

    it('parses targetKeys from JSON', async () => {
      (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>).mockResolvedValue(0);
      (jobs.listRunnable as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'j-1',
          accountId: 'space-1',
          serviceId: 'w-1',
          workerId: 'w-1',
          targetKeysJson: '["MY_VAR","ANOTHER"]',
          trigger: 'workspace_env_put',
          attempts: 0,
        },
      ]);

      await orchestrator.processReconcileJobs(50);

      expect(reconciler.reconcileServiceCommonEnv).toHaveBeenCalledWith(
        'space-1',
        'w-1',
        expect.objectContaining({
          targetKeys: expect.any(Set),
        })
      );
    });
  });

  describe('enqueuePeriodicDriftSweep', () => {
    it('recovers stale then enqueues drift sweep', async () => {
      (jobs.recoverStaleProcessing as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (jobs.enqueuePeriodicDriftSweep as ReturnType<typeof vi.fn>).mockResolvedValue(5);

      const result = await orchestrator.enqueuePeriodicDriftSweep(100);

      expect(jobs.recoverStaleProcessing).toHaveBeenCalledWith(100);
      expect(jobs.enqueuePeriodicDriftSweep).toHaveBeenCalledWith(100);
      expect(result).toBe(5);
    });
  });
});
