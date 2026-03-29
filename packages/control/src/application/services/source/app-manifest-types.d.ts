export type AppMetadata = {
    name: string;
    appId?: string;
};
export type ResourceLimits = {
    maxSizeMb?: number;
    maxRows?: number;
    maxKeys?: number;
};
type AppResourceBase = {
    binding?: string;
    generate?: boolean;
    limits?: ResourceLimits;
};
type D1Resource = AppResourceBase & {
    type: 'd1';
    migrations?: string | {
        up: string;
        down: string;
    };
};
type R2Resource = AppResourceBase & {
    type: 'r2';
};
type KVResource = AppResourceBase & {
    type: 'kv';
};
type SecretRefResource = AppResourceBase & {
    type: 'secretRef';
};
type VectorizeResource = AppResourceBase & {
    type: 'vectorize';
    vectorize: {
        dimensions: number;
        metric: 'cosine' | 'euclidean' | 'dot-product';
    };
};
type QueueResource = AppResourceBase & {
    type: 'queue';
    queue?: {
        maxRetries?: number;
        deadLetterQueue?: string;
        deliveryDelaySeconds?: number;
    };
};
type AnalyticsEngineResource = AppResourceBase & {
    type: 'analyticsEngine';
    analyticsEngine?: {
        dataset?: string;
    };
};
type WorkflowResource = AppResourceBase & {
    type: 'workflow';
    workflow: {
        service: string;
        export: string;
        timeoutMs?: number;
        maxRetries?: number;
    };
};
type DurableObjectResource = AppResourceBase & {
    type: 'durableObject';
    durableObject: {
        className: string;
        scriptName?: string;
    };
};
export type AppResource = D1Resource | R2Resource | KVResource | SecretRefResource | VectorizeResource | QueueResource | AnalyticsEngineResource | WorkflowResource | DurableObjectResource;
export type WorkflowArtifactBuild = {
    fromWorkflow: {
        path: string;
        job: string;
        artifact: string;
        artifactPath: string;
    };
};
export type HealthCheck = {
    type?: 'http' | 'tcp' | 'exec';
    path?: string;
    port?: number;
    command?: string;
    intervalSeconds?: number;
    timeoutSeconds?: number;
    unhealthyThreshold?: number;
};
export type LifecycleHook = {
    command: string;
    timeoutSeconds?: number;
    sandbox?: boolean;
};
export type LifecycleHooks = {
    preApply?: LifecycleHook;
    postApply?: LifecycleHook;
};
export type UpdateStrategy = {
    strategy?: 'rolling' | 'canary' | 'blue-green' | 'recreate';
    canaryWeight?: number;
    healthCheck?: string;
    rollbackOnFailure?: boolean;
    timeoutSeconds?: number;
};
export type ServiceBinding = string | {
    name: string;
    version?: string;
};
export type Volume = {
    name: string;
    mountPath: string;
    size: string;
};
export type WorkerScaling = {
    minInstances?: number;
    maxConcurrency?: number;
};
/** Container definition (CF Containers — worker に紐づけて使う) */
export type AppContainer = {
    dockerfile: string;
    port: number;
    instanceType?: string;
    maxInstances?: number;
    env?: Record<string, string>;
    volumes?: Volume[];
    dependsOn?: string[];
};
/** Service definition (常設コンテナ — VPS/独立稼働) */
export type AppService = {
    dockerfile: string;
    port: number;
    instanceType?: string;
    maxInstances?: number;
    ipv4?: boolean;
    env?: Record<string, string>;
    healthCheck?: HealthCheck;
    bindings?: {
        services?: ServiceBinding[];
    };
    triggers?: {
        schedules?: Array<{
            cron: string;
            export: string;
        }>;
    };
    volumes?: Volume[];
    dependsOn?: string[];
};
/** Worker definition (CF Workers) */
export type AppWorker = {
    containers?: string[];
    build: WorkflowArtifactBuild;
    env?: Record<string, string>;
    bindings?: {
        d1?: string[];
        r2?: string[];
        kv?: string[];
        vectorize?: string[];
        queues?: string[];
        analytics?: string[];
        workflows?: string[];
        durableObjects?: string[];
        services?: ServiceBinding[];
    };
    triggers?: {
        schedules?: Array<{
            cron: string;
            export: string;
        }>;
        queues?: Array<{
            queue: string;
            export: string;
        }>;
    };
    healthCheck?: HealthCheck;
    scaling?: WorkerScaling;
    dependsOn?: string[];
};
/** Env configuration with template injection support */
export type AppEnvConfig = {
    required?: string[];
    inject?: Record<string, string>;
};
export type AppRoute = {
    name: string;
    target: string;
    path?: string;
    methods?: string[];
    ingress?: string;
    timeoutMs?: number;
};
export type AppMcpServer = {
    name: string;
    endpoint?: string;
    route?: string;
    transport?: 'streamable-http';
    authSecretRef?: string;
};
export type AppFileHandler = {
    name: string;
    mimeTypes?: string[];
    extensions?: string[];
    openPath: string;
};
export type EnvironmentOverrides = Record<string, {
    containers?: Record<string, Partial<AppContainer>>;
    workers?: Record<string, Partial<AppWorker>>;
    services?: Record<string, Partial<AppService>>;
}>;
export type AppManifest = {
    apiVersion: 'takos.dev/v1alpha1';
    kind: 'App';
    metadata: AppMetadata;
    spec: {
        version: string;
        description?: string;
        icon?: string;
        category?: 'app' | 'service' | 'library' | 'template' | 'social';
        tags?: string[];
        capabilities?: string[];
        env?: AppEnvConfig;
        oauth?: {
            clientName: string;
            redirectUris: string[];
            scopes: string[];
            autoEnv?: boolean;
            metadata?: {
                logoUri?: string;
                tosUri?: string;
                policyUri?: string;
            };
        };
        takos?: {
            scopes: string[];
            minVersion?: string;
        };
        resources?: Record<string, AppResource>;
        containers?: Record<string, AppContainer>;
        services?: Record<string, AppService>;
        workers?: Record<string, AppWorker>;
        routes?: AppRoute[];
        lifecycle?: LifecycleHooks;
        update?: UpdateStrategy;
        mcpServers?: AppMcpServer[];
        fileHandlers?: AppFileHandler[];
        overrides?: EnvironmentOverrides;
    };
};
export type AppDeploymentBuildSource = {
    service_name: string;
    workflow_path: string;
    workflow_job: string;
    workflow_artifact: string;
    artifact_path: string;
    workflow_run_id?: string;
    workflow_job_id?: string;
    source_sha?: string;
};
export type BundleDoc = {
    apiVersion: 'takos.dev/v1alpha1';
    kind: 'Package' | 'Resource' | 'Workload' | 'Endpoint' | 'Binding' | 'McpServer';
    metadata: {
        name: string;
        labels?: Record<string, string>;
    };
    spec: Record<string, unknown>;
};
export declare const BUILD_SOURCE_LABELS: {
    readonly workflowPath: "takos.dev/workflow-path";
    readonly workflowJob: "takos.dev/workflow-job";
    readonly workflowArtifact: "takos.dev/workflow-artifact";
    readonly artifactPath: "takos.dev/artifact-path";
    readonly sourceRunId: "takos.dev/workflow-run-id";
    readonly sourceJobId: "takos.dev/workflow-job-id";
    readonly sourceSha: "takos.dev/source-sha";
};
export {};
//# sourceMappingURL=app-manifest-types.d.ts.map