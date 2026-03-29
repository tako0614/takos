import type { Env } from '../../../shared/types';
export type CommonEnvReconcileTrigger = 'workspace_env_put' | 'workspace_env_delete' | 'worker_env_patch' | 'manual_links_set' | 'manual_links_patch' | 'bundle_required_links' | 'periodic_drift' | 'retry_dispatch';
export type CommonEnvReconcileStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'retry_wait' | 'dead_letter';
export interface CommonEnvReconcileJobRow {
    id: string;
    accountId: string;
    serviceId: string;
    workerId: string;
    targetKeysJson: string | null;
    trigger: CommonEnvReconcileTrigger;
    status: CommonEnvReconcileStatus;
    attempts: number;
    nextAttemptAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
}
export declare class CommonEnvReconcileJobStore {
    private readonly env;
    constructor(env: Env);
    private listActiveJobsForService;
    private listActiveJobsForWorker;
    private bumpRetryWaitToPending;
    private retargetActiveJob;
    enqueueService(params: {
        spaceId: string;
        serviceId: string;
        targetKeys?: string[];
        trigger: CommonEnvReconcileTrigger;
    }): Promise<string>;
    enqueue(params: {
        spaceId: string;
        workerId: string;
        targetKeys?: string[];
        trigger: CommonEnvReconcileTrigger;
    }): Promise<string>;
    enqueueForServices(params: {
        spaceId: string;
        serviceIds: string[];
        targetKeys?: string[];
        trigger: CommonEnvReconcileTrigger;
    }): Promise<void>;
    enqueueForWorkers(params: {
        spaceId: string;
        workerIds: string[];
        targetKeys?: string[];
        trigger: CommonEnvReconcileTrigger;
    }): Promise<void>;
    listRunnable(limit: number): Promise<CommonEnvReconcileJobRow[]>;
    markProcessing(jobId: string): Promise<boolean>;
    markCompleted(jobId: string): Promise<void>;
    markRetry(jobId: string, currentAttempts: number, error: unknown): Promise<void>;
    private listStaleProcessing;
    recoverStaleProcessing(limit: number): Promise<number>;
    enqueuePeriodicDriftSweep(limit: number): Promise<number>;
    static parseTargetKeys(row: {
        targetKeysJson: string | null;
    }): string[] | undefined;
}
//# sourceMappingURL=reconcile-jobs.d.ts.map