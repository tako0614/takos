import type { Env } from '../../../shared/types';
import { CommonEnvReconcileJobStore, type CommonEnvReconcileTrigger } from './reconcile-jobs';
import { CommonEnvReconciler } from './reconciler';
export declare class CommonEnvOrchestrator {
    private readonly env;
    private readonly jobs;
    private readonly reconciler;
    constructor(env: Pick<Env, 'DB'>, jobs: CommonEnvReconcileJobStore, reconciler: CommonEnvReconciler);
    enqueueServiceReconcile(params: {
        spaceId: string;
        serviceId: string;
        targetKeys?: string[];
        trigger: CommonEnvReconcileTrigger;
    }): Promise<void>;
    reconcileServicesForEnvKey(spaceId: string, envNameRaw: string, trigger?: CommonEnvReconcileTrigger): Promise<void>;
    reconcileServices(params: {
        spaceId: string;
        serviceIds: string[];
        keys?: string[];
        trigger?: CommonEnvReconcileTrigger;
    }): Promise<void>;
    processReconcileJobs(limit?: number): Promise<{
        processed: number;
        completed: number;
        retried: number;
    }>;
    enqueuePeriodicDriftSweep(limit?: number): Promise<number>;
}
//# sourceMappingURL=orchestrator.d.ts.map
