import type { TenantWorkerFetcher, TenantWorkerQueueMessage, TenantWorkerQueueResult, TenantWorkerScheduledOptions, TenantWorkerScheduledResult, TenantWorkflowInvocation } from './tenant-worker-runtime.ts';
import { type LocalTenantWorkerRegistryOptions } from './miniflare-bindings.ts';
export declare function createLocalTenantRuntimeRegistry(options: LocalTenantWorkerRegistryOptions): Promise<{
    get(name: string, registryOptions?: {
        deploymentId?: string;
    }): TenantWorkerFetcher;
    dispatchScheduled(name: string, scheduledOptions?: TenantWorkerScheduledOptions, registryOptions?: {
        deploymentId?: string;
    }): Promise<TenantWorkerScheduledResult>;
    dispatchQueue(name: string, queueName: string, messages: TenantWorkerQueueMessage[], registryOptions?: {
        deploymentId?: string;
    }): Promise<TenantWorkerQueueResult>;
    invokeWorkflow(name: string, invocation: TenantWorkflowInvocation, registryOptions?: {
        deploymentId?: string;
    }): Promise<never>;
    dispose(): Promise<void>;
}>;
//# sourceMappingURL=miniflare-registry.d.ts.map