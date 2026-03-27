import type { Env } from '../../../shared/types';
import { normalizeEnvName, uniqueEnvNames } from './crypto';
import {
  CommonEnvReconcileJobStore,
  type CommonEnvReconcileTrigger,
} from './reconcile-jobs';
import { listServiceIdsLinkedToEnvKey } from './repository';
import { CommonEnvReconciler } from './reconciler';
import { logError } from '../../../shared/utils/logger';

export class CommonEnvOrchestrator {
  constructor(
    private readonly env: Pick<Env, 'DB'>,
    private readonly jobs: CommonEnvReconcileJobStore,
    private readonly reconciler: CommonEnvReconciler
  ) {}

  async enqueueServiceReconcile(params: {
    spaceId: string;
    serviceId: string;
    targetKeys?: string[];
    trigger: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.jobs.enqueueService({
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      targetKeys: params.targetKeys,
      trigger: params.trigger,
    });
  }

  async enqueueWorkerReconcile(params: {
    spaceId: string;
    workerId: string;
    targetKeys?: string[];
    trigger: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.enqueueServiceReconcile({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      targetKeys: params.targetKeys,
      trigger: params.trigger,
    });
  }

  async reconcileWorkersForEnvKey(
    spaceId: string,
    envNameRaw: string,
    trigger: CommonEnvReconcileTrigger = 'workspace_env_put'
  ): Promise<void> {
    await this.reconcileServicesForEnvKey(spaceId, envNameRaw, trigger);
  }

  async reconcileServicesForEnvKey(
    spaceId: string,
    envNameRaw: string,
    trigger: CommonEnvReconcileTrigger = 'workspace_env_put'
  ): Promise<void> {
    const envName = normalizeEnvName(envNameRaw);
    const serviceIds = await listServiceIdsLinkedToEnvKey(this.env, spaceId, envName);
    await this.jobs.enqueueForServices({
      spaceId,
      serviceIds,
      targetKeys: [envName],
      trigger,
    });
  }

  async reconcileWorkers(params: {
    spaceId: string;
    workerIds: string[];
    keys?: string[];
    trigger?: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.reconcileServices({
      spaceId: params.spaceId,
      serviceIds: params.workerIds,
      keys: params.keys,
      trigger: params.trigger,
    });
  }

  async reconcileServices(params: {
    spaceId: string;
    serviceIds: string[];
    keys?: string[];
    trigger?: CommonEnvReconcileTrigger;
  }): Promise<void> {
    const targetKeys = params.keys ? uniqueEnvNames(params.keys) : undefined;
    await this.jobs.enqueueForServices({
      spaceId: params.spaceId,
      serviceIds: params.serviceIds,
      targetKeys,
      trigger: params.trigger || 'bundle_required_links',
    });
  }

  async processReconcileJobs(limit = 50): Promise<{ processed: number; completed: number; retried: number }> {
    const recoveredStale = await this.jobs.recoverStaleProcessing(limit);
    const jobs = await this.jobs.listRunnable(limit);
    let completed = 0;
    let retried = recoveredStale;

    for (const job of jobs) {
      const claimed = await this.jobs.markProcessing(job.id);
      if (!claimed) continue;
      const keys = CommonEnvReconcileJobStore.parseTargetKeys(job);
      const normalizedTargetKeys = keys ? new Set(uniqueEnvNames(keys)) : undefined;

      try {
        await this.reconciler.reconcileServiceCommonEnv(job.accountId, job.serviceId, {
          targetKeys: normalizedTargetKeys,
          trigger: job.trigger,
        });
        await this.jobs.markCompleted(job.id);
        completed += 1;
      } catch (error) {
        try {
          await this.reconciler.markServiceLinksApplyFailed({
            spaceId: job.accountId,
            serviceId: job.serviceId,
            targetKeys: normalizedTargetKeys,
            error,
          });
        } catch (updateError) {
          logError('failed to mark link apply failure runtime state', updateError, { module: 'common-env' });
        }
        await this.jobs.markRetry(job.id, job.attempts, error);
        retried += 1;
      }
    }

    return {
      processed: jobs.length + recoveredStale,
      completed,
      retried,
    };
  }

  async enqueuePeriodicDriftSweep(limit = 100): Promise<number> {
    await this.jobs.recoverStaleProcessing(limit);
    return this.jobs.enqueuePeriodicDriftSweep(limit);
  }
}

export { CommonEnvOrchestrator as ServiceCommonEnvOrchestrator };
