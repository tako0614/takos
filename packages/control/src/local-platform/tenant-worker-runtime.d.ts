import type { D1Database, Fetcher, R2Bucket } from '../shared/types/bindings.ts';
import type { ServiceTargetMap } from './url-registry.ts';
export type TenantWorkerScheduledOptions = {
    scheduledTime?: Date;
    cron?: string;
};
export type TenantWorkerScheduledResult = {
    outcome: string;
    noRetry: boolean;
};
export type TenantWorkerQueueMessage<Body = unknown> = {
    id: string;
    timestamp: Date;
    attempts: number;
} & ({
    body: Body;
} | {
    serializedBody: ArrayBuffer | ArrayBufferView;
});
export type TenantWorkerQueueResult = {
    outcome: string;
    ackAll: boolean;
    retryBatch: unknown;
    explicitAcks: string[];
    retryMessages: unknown[];
};
export type TenantWorkflowInvocation = {
    exportName: string;
    payload?: unknown;
};
export type TenantWorkerFetcher = Fetcher & {
    scheduled(options?: TenantWorkerScheduledOptions): Promise<TenantWorkerScheduledResult>;
    queue(queueName: string, messages: TenantWorkerQueueMessage[]): Promise<TenantWorkerQueueResult>;
};
export type TenantWorkerRuntimeFactoryOptions = {
    db: D1Database;
    workerBundles?: R2Bucket;
    encryptionKey?: string;
    bundleCacheRoot?: string | null;
    persistRoot?: string | null;
    serviceTargets?: ServiceTargetMap;
    /** PostgreSQL pool for pgvector-backed Vectorize bindings. */
    pgPool?: {
        query(text: string, values?: unknown[]): Promise<{
            rows: Record<string, unknown>[];
            rowCount: number | null;
        }>;
    };
    /** OpenAI API key for AI bindings (auto-injected to all tenant workers). */
    openAiApiKey?: string;
    /** OpenAI-compatible base URL for AI bindings. */
    openAiBaseUrl?: string;
    /** OTEL collector endpoint for Analytics Engine bindings. */
    otelEndpoint?: string;
};
export type TenantWorkerRuntimeRegistry = {
    get(name: string, options?: {
        deploymentId?: string;
    }): TenantWorkerFetcher;
    dispatchScheduled(name: string, scheduledOptions?: TenantWorkerScheduledOptions, options?: {
        deploymentId?: string;
    }): Promise<TenantWorkerScheduledResult>;
    dispatchQueue(name: string, queueName: string, messages: TenantWorkerQueueMessage[], options?: {
        deploymentId?: string;
    }): Promise<TenantWorkerQueueResult>;
    invokeWorkflow(name: string, invocation: TenantWorkflowInvocation, options?: {
        deploymentId?: string;
    }): Promise<never>;
    dispose(): Promise<void>;
};
export type LocalTenantWorkerRuntimeFactoryOptions = {
    dataDir?: string | null;
} & Omit<TenantWorkerRuntimeFactoryOptions, 'bundleCacheRoot' | 'persistRoot'>;
export declare function createLocalTenantWorkerRuntimeRegistry(options: LocalTenantWorkerRuntimeFactoryOptions): Promise<TenantWorkerRuntimeRegistry>;
//# sourceMappingURL=tenant-worker-runtime.d.ts.map