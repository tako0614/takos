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

export type AppResource = {
  type: 'd1' | 'r2' | 'kv' | 'secretRef' | 'vectorize' | 'queue' | 'analyticsEngine' | 'workflow' | 'durableObject';
  binding?: string;
  generate?: boolean;
  migrations?: string | { up: string; down: string };
  vectorize?: {
    dimensions: number;
    metric: 'cosine' | 'euclidean' | 'dot-product';
  };
  queue?: {
    maxRetries?: number;
    deadLetterQueue?: string;
    deliveryDelaySeconds?: number;
  };
  analyticsEngine?: {
    dataset?: string;
  };
  workflow?: {
    service: string;
    export: string;
    timeoutMs?: number;
    maxRetries?: number;
  };
  durableObject?: {
    className: string;
    scriptName?: string;
  };
  limits?: ResourceLimits;
};

export type WorkflowArtifactBuild = {
  fromWorkflow: {
    path: string;
    job: string;
    artifact: string;
    artifactPath: string;
  };
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
    services?: ServiceBinding[];  // 他の service/worker を参照
  };
  triggers?: {
    schedules?: Array<{ cron: string; export: string }>;
  };
  volumes?: Volume[];
  dependsOn?: string[];
};

/** Worker definition (CF Workers) */
export type AppWorker = {
  containers?: string[]; // references to keys in spec.containers
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

export const BUILD_SOURCE_LABELS = {
  workflowPath: 'takos.dev/workflow-path',
  workflowJob: 'takos.dev/workflow-job',
  workflowArtifact: 'takos.dev/workflow-artifact',
  artifactPath: 'takos.dev/artifact-path',
  sourceRunId: 'takos.dev/workflow-run-id',
  sourceJobId: 'takos.dev/workflow-job-id',
  sourceSha: 'takos.dev/source-sha',
} as const;

