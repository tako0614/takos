export type AppMetadata = {
  name: string;
  appId?: string;
};

// --- Resource limits ---

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
  migrations?: string | { up: string; down: string };
};

type R2Resource = AppResourceBase & { type: 'r2' };
type KVResource = AppResourceBase & { type: 'kv' };
type SecretRefResource = AppResourceBase & { type: 'secretRef' };

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

type WorkflowConfig = {
  service: string;
  export: string;
  timeoutMs?: number;
  maxRetries?: number;
};

type WorkflowResource = AppResourceBase & {
  type: 'workflow';
  workflow: WorkflowConfig;
};

type WorkflowRuntimeResource = AppResourceBase & {
  type: 'workflow_runtime';
  workflowRuntime: WorkflowConfig;
};

type DurableObjectConfig = {
  className: string;
  scriptName?: string;
};

type DurableObjectResource = AppResourceBase & {
  type: 'durableObject';
  durableObject: DurableObjectConfig;
};

type DurableNamespaceResource = AppResourceBase & {
  type: 'durable_namespace';
  durableNamespace: DurableObjectConfig;
};

export type AppResource =
  | D1Resource
  | R2Resource
  | KVResource
  | SecretRefResource
  | VectorizeResource
  | QueueResource
  | AnalyticsEngineResource
  | WorkflowResource
  | WorkflowRuntimeResource
  | DurableObjectResource
  | DurableNamespaceResource;

export type AppResourceType = AppResource['type'];

export type WorkflowArtifactBuild = {
  fromWorkflow: {
    path: string;
    job: string;
    artifact: string;
    artifactPath: string;
  };
};

export type DirectWorkerArtifact = {
  kind: 'bundle';
  deploymentId?: string;
  artifactRef?: string;
};

export type DirectImageArtifact = {
  kind: 'image';
  imageRef: string;
  provider?: 'oci' | 'ecs' | 'cloud-run' | 'k8s';
};

// --- Health check ---

export type HealthCheck = {
  type?: 'http' | 'tcp' | 'exec';  // default: 'http'
  path?: string;           // http: GET パス
  port?: number;           // tcp: ポート
  command?: string;        // exec: コマンド
  intervalSeconds?: number;
  timeoutSeconds?: number;
  unhealthyThreshold?: number;
};

// --- Lifecycle hooks ---

export type LifecycleHook = {
  command: string;
  timeoutSeconds?: number;
  sandbox?: boolean;     // true: 隔離コンテナで実行。Store インストール時は必須
};

export type LifecycleHooks = {
  preApply?: LifecycleHook;
  postApply?: LifecycleHook;
};

// --- Update / rollback strategy ---

export type UpdateStrategy = {
  strategy?: 'rolling' | 'canary' | 'blue-green' | 'recreate';
  canaryWeight?: number;
  healthCheck?: string;
  rollbackOnFailure?: boolean;
  timeoutSeconds?: number;
};

// --- Service binding (dependency version constraint) ---

export type ServiceBinding = string | { name: string; version?: string };

// --- Volume ---

export type Volume = {
  name: string;
  mountPath: string;
  size: string;  // "10Gi", "500Mi" etc
};

// --- Worker scaling ---

export type WorkerScaling = {
  minInstances?: number;
  maxConcurrency?: number;
};

// --- Container & Worker types ---

/** Container definition (CF Containers — worker に紐づけて使う) */
export type AppContainer = {
  dockerfile?: string;
  imageRef?: string;
  artifact?: DirectImageArtifact;
  provider?: 'oci' | 'ecs' | 'cloud-run' | 'k8s';
  port: number;
  instanceType?: string;
  maxInstances?: number;
  env?: Record<string, string>;
  volumes?: Volume[];
  dependsOn?: string[];
};

/** Service definition (常設コンテナ — VPS/独立稼働) */
export type AppService = {
  dockerfile?: string;
  imageRef?: string;
  artifact?: DirectImageArtifact;
  provider?: 'oci' | 'ecs' | 'cloud-run' | 'k8s';
  port: number;
  instanceType?: string;
  maxInstances?: number;
  ipv4?: boolean;
  env?: Record<string, string>;
  healthCheck?: HealthCheck;
  bindings?: {
    services?: ServiceBinding[];  // 他の service/worker を参照
  };
  triggers?: {
    schedules?: Array<{ cron: string; export: string }>;
  };
  volumes?: Volume[];
  dependsOn?: string[];
};

export type AppWorkloadBindings = {
  resources?: string[];
  d1?: string[];
  r2?: string[];
  kv?: string[];
  queues?: string[];
  vectorize?: string[];
  analyticsEngine?: string[];
  workflow?: string[];
  durableObjects?: string[];
  services?: ServiceBinding[];
};

/** Worker definition (CF Workers) */
export type AppWorker = {
  containers?: string[]; // references to keys in spec.containers
  build?: WorkflowArtifactBuild;
  artifact?: DirectWorkerArtifact;
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
    schedules?: Array<{ cron: string; export: string }>;
    queues?: Array<{ queue: string; export: string }>;
  };
  healthCheck?: HealthCheck;
  scaling?: WorkerScaling;
  dependsOn?: string[];
};

/** Env configuration with template injection support */
export type AppEnvConfig = {
  required?: string[];
  inject?: Record<string, string>; // template values: "{{routes.api.url}}"
};

// --- Route types ---

export type AppRoute = {
  name: string;
  target: string;
  path?: string;
  methods?: string[];    // ['GET', 'POST'] etc
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

// --- Environment overrides ---

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
      metadata?: { logoUri?: string; tosUri?: string; policyUri?: string };
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

// Resource-type aliases that map portable/legacy manifest names to Cloudflare-native
// resource types used by the current application spec.
export type LegacyAppResourceTypeAlias =
  | 'secret_ref'
  | 'analytics_engine'
  | 'workflow_binding'
  | 'durable_object_namespace'
  | 'secret'
  | 'sql'
  | 'object_store'
  | 'vector_index'
  | 'analytics_store'
  | 'workflow_runtime'
  | 'durable_namespace';

export const APP_RESOURCE_TYPE_ALIASES: Record<LegacyAppResourceTypeAlias, AppResource['type']> = {
  secret_ref: 'secretRef',
  analytics_engine: 'analyticsEngine',
  workflow_binding: 'workflow',
  durable_object_namespace: 'durableObject',
  secret: 'secretRef',
  sql: 'd1',
  object_store: 'r2',
  vector_index: 'vectorize',
  analytics_store: 'analyticsEngine',
  workflow_runtime: 'workflow',
  durable_namespace: 'durableObject',
};

export const BUILD_SOURCE_LABELS = {
  workflowPath: 'takos.dev/workflow-path',
  workflowJob: 'takos.dev/workflow-job',
  workflowArtifact: 'takos.dev/workflow-artifact',
  artifactPath: 'takos.dev/artifact-path',
  sourceRunId: 'takos.dev/workflow-run-id',
  sourceJobId: 'takos.dev/workflow-job-id',
  sourceSha: 'takos.dev/source-sha',
} as const;
