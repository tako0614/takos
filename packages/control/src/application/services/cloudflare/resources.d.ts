import type { Env } from '../../../shared/types';
import { WFPService, type WfpEnv } from '../wfp';
export type CloudflareManagedResourceType = 'd1' | 'r2' | 'kv' | 'queue' | 'analyticsEngine' | 'analytics_engine' | 'workflow' | 'vectorize';
export type CloudflareDeletableResourceType = CloudflareManagedResourceType | 'worker';
type VectorizeCreateOptions = {
    dimensions: number;
    metric: 'cosine' | 'euclidean' | 'dot-product';
};
type QueueCreateOptions = {
    deliveryDelaySeconds?: number;
};
type AnalyticsEngineCreateOptions = {
    dataset?: string;
};
type WorkflowCreateOptions = {
    service?: string;
    export?: string;
    timeoutMs?: number;
    maxRetries?: number;
};
export declare class CloudflareResourceService {
    readonly wfp: WFPService;
    constructor(env: Pick<Env, 'CF_ACCOUNT_ID' | 'CF_API_TOKEN' | 'WFP_DISPATCH_NAMESPACE'> | WfpEnv);
    createResource(type: CloudflareManagedResourceType, name: string, options?: {
        vectorize?: VectorizeCreateOptions;
        queue?: QueueCreateOptions;
        analyticsEngine?: AnalyticsEngineCreateOptions;
        workflow?: WorkflowCreateOptions;
    }): Promise<{
        cfId: string | null;
        cfName: string;
    }>;
    deleteResource(params: {
        type: string;
        cfId?: string | null;
        cfName?: string | null;
    }): Promise<void>;
}
export {};
//# sourceMappingURL=resources.d.ts.map