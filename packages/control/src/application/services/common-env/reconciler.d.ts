import type { Env } from '../../../shared/types';
import type { CommonEnvReconcileTrigger } from './reconcile-jobs';
export declare class CommonEnvReconciler {
    private readonly env;
    constructor(env: Env);
    markServiceLinksApplyFailed(params: {
        spaceId: string;
        serviceId: string;
        targetKeys?: Set<string>;
        error: unknown;
    }): Promise<void>;
    reconcileServiceCommonEnv(spaceId: string, serviceId: string, options?: {
        targetKeys?: Set<string>;
        trigger?: CommonEnvReconcileTrigger;
    }): Promise<void>;
}
export { CommonEnvReconciler as ServiceCommonEnvReconciler };
//# sourceMappingURL=reconciler.d.ts.map