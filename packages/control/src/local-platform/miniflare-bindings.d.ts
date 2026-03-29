import type { D1Database, Fetcher, R2Bucket } from '../shared/types/bindings.ts';
import type { WorkerBinding } from '../application/services/wfp/index.ts';
import type { ServiceTargetMap } from './url-registry.ts';
export type FetcherLike = Fetcher;
export type LocalTenantWorkerRegistryOptions = {
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
    /** OpenAI API key for AI bindings. */
    openAiApiKey?: string;
    /** OpenAI-compatible base URL for AI bindings. */
    openAiBaseUrl?: string;
    /** OTEL collector endpoint for Analytics Engine bindings. */
    otelEndpoint?: string;
};
export type DeploymentRuntimeRecord = {
    id: string;
    serviceId: string;
    routeRef: string;
    artifactRef: string;
    bundleR2Key: string;
    wasmR2Key: string | null;
    runtimeConfigSnapshotJson: string;
    bindingsSnapshotEncrypted: string | null;
    envVarsSnapshotEncrypted: string | null;
};
export type WorkerRuntimeConfigSnapshot = {
    compatibility_date?: string;
    compatibility_flags?: string[];
};
export type PreparedBundle = {
    bundleContent: string;
    workerDir: string;
    scriptPath: string;
};
export declare function resolveRoot(explicit: string | null | undefined, suffix: string): string;
export declare function sanitizeWorkerRef(workerRef: string): string;
export declare function parseRuntimeConfig(raw: string | null | undefined): WorkerRuntimeConfigSnapshot;
export declare function decryptBindingsSnapshot(deployment: DeploymentRuntimeRecord, encryptionKey: string | undefined): Promise<WorkerBinding[]>;
export declare function decryptEnvVarSnapshot(deployment: DeploymentRuntimeRecord, encryptionKey: string | undefined): Promise<Record<string, string>>;
export declare function resolveDeploymentRuntime(dbBinding: D1Database, workerRef: string, options?: {
    deploymentId?: string;
}): Promise<DeploymentRuntimeRecord | null>;
export declare function loadBundleContent(workerBundles: R2Bucket, deployment: DeploymentRuntimeRecord, bundleCacheRoot: string): Promise<PreparedBundle>;
export declare function createMissingBindingFetcher(kind: string, name: string): Fetcher;
export declare function normalizeFetcherInput(input: RequestInfo | URL, init?: RequestInit): [string | URL, RequestInit | undefined];
//# sourceMappingURL=miniflare-bindings.d.ts.map