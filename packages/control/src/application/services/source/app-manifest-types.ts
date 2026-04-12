// ============================================================
// AppManifest — flat canonical schema (Phase 1)
// ============================================================
//
// This file is the single source of truth for the Takos app manifest
// internal type. The envelope-style `apiVersion/kind/metadata/spec`
// structure has been retired in favor of a flat top-level shape that
// mirrors the docs canonical spec (`docs/apps/manifest.md`).
//
// Phase 1 scope:
//   - Rewrite AppManifest, AppCompute, AppStorage, AppPublication, etc.
//   - Keep legacy type aliases (AppWorker/AppService/AppContainer/AppResource/
//     AppMcpServer/AppFileHandler) so that the existing deploy pipeline
//     code keeps parsing until Phase 2 rewrites it.
//
// Do NOT add new code that depends on the envelope shape.
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

// --- Triggers (worker-only) ---

export type ScheduleTrigger = {
  cron: string;
};

export type QueueTrigger = {
  storage: string; // canonical field name (not `queue`)
  batchSize?: number;
  maxRetries?: number;
};

export type AppTriggers = {
  schedules?: ScheduleTrigger[];
  queues?: QueueTrigger[];
};

export type AppConsume = {
  publication: string;
  env?: Record<string, string>;
};

// --- Compute (worker / service / attached-container) ---

export type ComputeKind = "worker" | "service" | "attached-container";

export type AppCompute = {
  kind: ComputeKind; // auto-detected by parser
  build?: BuildConfig;
  image?: string;
  port?: number;
  env?: Record<string, string>;
  readiness?: string;
  scaling?: {
    minInstances?: number;
    maxInstances?: number;
  };
  instanceType?: string;
  volumes?: Record<string, VolumeMount>;
  containers?: Record<string, AppCompute>; // attached containers (only when kind='worker')
  depends?: string[];
  triggers?: AppTriggers;
  healthCheck?: HealthCheck; // service / attached only
  dockerfile?: string; // local provider only
  consume?: AppConsume[];
  /**
   * Legacy alias for `scaling.maxInstances`. Transitional — Phase 2 removes.
   */
  maxInstances?: number;
};

// --- Storage (legacy/internal resource model) ---

export type StorageType =
  | "sql"
  | "object-store"
  | "key-value"
  | "queue"
  | "vector-index"
  | "secret"
  | "analytics-engine"
  | "workflow"
  | "durable-object";

/**
 * @deprecated Internal-only legacy storage model.
 *
 * Public app manifests must use provider-backed publications and
 * `compute.<name>.consume` for wiring. This type remains available for
 * internal deploy / translation code until the remaining callers are
 * fully removed.
 */
export type AppStorage = {
  type: StorageType;
  bind?: string;
  // type-specific
  /** sql only */
  migrations?: string;
  /** queue only */
  queue?: {
    maxRetries?: number;
    deadLetterQueue?: string;
  };
  /** vector-index only */
  vectorIndex?: {
    dimensions?: number;
    metric?: "cosine" | "euclidean" | "dot-product";
  };
  /** secret only */
  generate?: boolean;
  /** workflow only */
  workflow?: {
    class: string;
    script: string;
  };
  /** durable-object only */
  durableObject?: {
    class: string;
    script: string;
  };
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
  provider?: string;
  kind?: string;
  spec?: Record<string, unknown>;
  type?: string;
  path?: string;
  title?: string;
  // route/public interface fields
  /** McpServer */
  transport?: string;
  /** McpServer */
  authSecretRef?: string;
  /** FileHandler */
  mimeTypes?: string[];
  /** FileHandler */
  extensions?: string[];
  /** UiSurface */
  icon?: string;
};

// --- Environment overrides ---

export type AppManifestOverride = Partial<
  Pick<
    AppManifest,
    "compute" | "routes" | "publish" | "env"
  >
>;

// --- Root manifest ---

export type AppManifest = {
  name: string;
  version?: string;
  compute: Record<string, AppCompute>;
  /**
   * @deprecated Internal-only legacy field. Public app manifests must not use
   * `storage`; publish a provider-backed resource and consume its outputs
   * instead.
   */
  storage?: Record<string, AppStorage>;
  routes: AppRoute[];
  publish: AppPublication[];
  env: Record<string, string>;
  overrides?: Record<string, AppManifestOverride>;
};

// ============================================================
// Legacy type aliases (transitional — Phase 2 removes)
// ============================================================
//
// These aliases let the existing deploy pipeline code keep compiling
// until Phase 2 refactors those callers. Do NOT use in new code.
// ============================================================

/** @deprecated Use `AppCompute` (kind: 'worker'). */
export type AppWorker = AppCompute & { kind: "worker" };

/** @deprecated Use `AppCompute` (kind: 'service'). */
export type AppService = AppCompute & { kind: "service" };

/** @deprecated Use `AppCompute` (kind: 'attached-container'). */
export type AppContainer = AppCompute & { kind: "attached-container" };

/** @deprecated Use `AppStorage`. */
export type AppResource = AppStorage;

/** @deprecated Use `AppPublication` (type: 'McpServer'). */
export type AppMcpServer = AppPublication & { type: "McpServer" };

/** @deprecated Use `AppPublication` (type: 'FileHandler'). */
export type AppFileHandler = AppPublication & { type: "FileHandler" };

// ============================================================
// Supporting types kept for deploy pipeline compatibility
// ============================================================

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
  apiVersion: "takos.dev/v1alpha1";
  kind:
    | "Package"
    | "Resource"
    | "Workload"
    | "Endpoint"
    | "Binding"
    | "McpServer";
  metadata: {
    name: string;
    labels?: Record<string, string>;
  };
  spec: Record<string, unknown>;
};

export const BUILD_SOURCE_LABELS = {
  workflowPath: "takos.dev/workflow-path",
  workflowJob: "takos.dev/workflow-job",
  workflowArtifact: "takos.dev/workflow-artifact",
  artifactPath: "takos.dev/artifact-path",
  sourceRunId: "takos.dev/workflow-run-id",
  sourceJobId: "takos.dev/workflow-job-id",
  sourceSha: "takos.dev/source-sha",
} as const;
