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

// --- Triggers (worker-only) ---

export type ScheduleTrigger = {
  cron: string;
};

export type AppTriggers = {
  schedules?: ScheduleTrigger[];
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
  volumes?: Record<string, VolumeMount>;
  containers?: Record<string, AppCompute>; // attached containers (only when kind='worker')
  depends?: string[];
  triggers?: AppTriggers;
  healthCheck?: HealthCheck; // service / attached only
  dockerfile?: string; // metadata only; image remains the runtime artifact
  consume?: AppConsume[];
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
    "compute" | "routes" | "publish" | "env"
  >
>;

// --- Root manifest ---

export type AppManifest = {
  name: string;
  version?: string;
  compute: Record<string, AppCompute>;
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
  apiVersion: "takos.dev/v1alpha1";
  kind: string;
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
