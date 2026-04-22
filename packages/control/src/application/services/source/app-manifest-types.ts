// ============================================================
// AppManifest — flat canonical schema
// ============================================================
//
// This file is the single source of truth for the Takos deploy manifest
// internal type. It mirrors the docs canonical spec
// (`docs/apps/manifest.md`).
// ============================================================

// --- Build configuration ---

export type BuildConfig = {
  fromWorkflow: {
    path: string;
    job: string;
    artifact: string;
    artifactPath?: string;
  };
};

// --- Volume mount (compute-local) ---

export type VolumeMount = {
  source: string;
  target: string;
  persistent?: boolean;
};

// --- Health check (service / attached container) ---

export type HealthCheck = {
  path?: string;
  interval?: number; // seconds
  timeout?: number; // seconds
  unhealthyThreshold?: number;
};

// --- Cloudflare native container metadata (worker + DO class) ---

export type CloudflareContainerInstanceType =
  | "lite"
  | "basic"
  | "standard-1"
  | "standard-2"
  | "standard-3"
  | "standard-4";

export type CloudflareContainerConfig = {
  /**
   * Worker binding name for the Durable Object namespace that hosts the
   * container-enabled DO class.
   */
  binding?: string;
  /** Exported Durable Object class name in the worker bundle. */
  className: string;
  instanceType?: CloudflareContainerInstanceType;
  maxInstances?: number;
  name?: string;
  imageBuildContext?: string;
  imageVars?: Record<string, string>;
  rolloutActiveGracePeriod?: number;
  rolloutStepPercentage?: number | number[];
  migrationTag?: string;
  sqlite?: boolean;
};

export type CloudflareComputeConfig = {
  container?: CloudflareContainerConfig;
};

// --- Triggers (worker-only) ---

export type ScheduleTrigger = {
  cron: string;
};

export type QueueTrigger = {
  /**
   * Queue runtime binding name on this worker. Prefer this for manifest-owned
   * apps because deploy can resolve the bound resource to the backing queue.
   */
  binding?: string;
  /**
   * Backing queue name. Use only when the queue is not bound to this worker.
   */
  queue?: string;
  deadLetterQueue?: string;
  maxBatchSize?: number;
  maxConcurrency?: number;
  maxRetries?: number;
  maxWaitTimeMs?: number;
  retryDelaySeconds?: number;
};

export type AppTriggers = {
  schedules?: ScheduleTrigger[];
  queues?: QueueTrigger[];
};

export type AppConsume = {
  publication: string;
  env?: Record<string, string>;
};

// --- Resources (managed resource + optional workload bindings) ---

export type AppResourceType =
  | "sql"
  | "object-store"
  | "key-value"
  | "queue"
  | "vector-index"
  | "secret"
  | "analytics-engine"
  | "workflow"
  | "durable-object";

export type AppResourceBinding = {
  target: string;
  binding: string;
};

export type AppResource = {
  type: AppResourceType;
  bind?: string;
  to?: string[];
  bindings?: AppResourceBinding[];
  migrations?: string;
  queue?: {
    deliveryDelaySeconds?: number;
    maxRetries?: number;
    deadLetterQueue?: string;
  };
  vectorIndex?: {
    dimensions?: number;
    metric?: "cosine" | "euclidean" | "dot-product";
  };
  generate?: boolean;
  analyticsEngine?: {
    dataset?: string;
  };
  workflow?: {
    service?: string;
    export?: string;
    timeoutMs?: number;
    maxRetries?: number;
  };
  durableObject?: {
    className?: string;
    scriptName?: string;
  };
};

// --- Compute (worker / service / attached-container) ---

export type ComputeKind = "worker" | "service" | "attached-container";

export type AppCompute = {
  kind: ComputeKind; // auto-detected by parser
  icon?: string; // publisher/default launcher image icon metadata
  build?: BuildConfig;
  image?: string;
  port?: number;
  env?: Record<string, string>;
  readiness?: string;
  scaling?: {
    minInstances?: number;
    maxInstances?: number;
  };
  volumes?: Record<string, VolumeMount>;
  containers?: Record<string, AppCompute>; // attached containers (only when kind='worker')
  depends?: string[];
  triggers?: AppTriggers;
  healthCheck?: HealthCheck; // service / attached only
  dockerfile?: string; // metadata only; image remains the runtime artifact
  consume?: AppConsume[];
  cloudflare?: CloudflareComputeConfig;
};

// --- Routes ---

export type AppRoute = {
  target: string; // compute name (required)
  path: string; // required, must start with '/'
  methods?: string[];
  timeoutMs?: number;
};

// --- Publications (MCP servers, file handlers, UI surfaces, etc.) ---

export type AppPublication = {
  name: string;
  publisher: string;
  type: string;
  path?: string;
  title?: string;
  spec?: Record<string, unknown>;
};

// --- Environment overrides ---

export type AppManifestOverride = Partial<
  Pick<
    AppManifest,
    "compute" | "routes" | "publish" | "env" | "resources"
  >
>;

// --- Root manifest ---

export type AppManifest = {
  name: string;
  version?: string;
  compute: Record<string, AppCompute>;
  resources?: Record<string, AppResource>;
  routes: AppRoute[];
  publish: AppPublication[];
  env: Record<string, string>;
  overrides?: Record<string, AppManifestOverride>;
};

// ============================================================
// Supporting types for the deploy pipeline
// ============================================================

export type GroupDeploymentSnapshotBuildSource = {
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
  type: string;
  name: string;
  labels?: Record<string, string>;
  config: Record<string, unknown>;
};

export const BUILD_SOURCE_LABELS = {
  workflowPath: "workflow_path",
  workflowJob: "workflow_job",
  workflowArtifact: "workflow_artifact",
  artifactPath: "artifact_path",
  sourceRunId: "workflow_run_id",
  sourceJobId: "workflow_job_id",
  sourceSha: "source_sha",
} as const;
