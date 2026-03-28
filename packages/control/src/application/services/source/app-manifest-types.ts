import type { WorkflowDiagnostic } from '@takos/actions-engine';

export type AppMetadata = {
  name: string;
  appId?: string;
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
};

export type WorkflowArtifactBuild = {
  fromWorkflow: {
    path: string;
    job: string;
    artifact: string;
    artifactPath: string;
  };
};

export type WorkerContainer = {
  name: string;
  dockerfile: string;
  port: number;
  instanceType?: string;
  maxInstances?: number;
};

export type WorkerService = {
  type: 'worker';
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
    services?: string[];
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
  containers?: WorkerContainer[];
};

export type ContainerService = {
  type: 'container';
  container: {
    dockerfile: string;
    port: number;
    instanceType?: string;
    maxInstances?: number;
  };
  env?: Record<string, string>;
};

export type AppService = WorkerService | ContainerService;

export type AppRoute = {
  name?: string;
  service: string;
  path?: string;
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
    env?: {
      required?: string[];
    };
    oauth?: {
      clientName: string;
      redirectUris: string[];
      scopes: string[];
      autoEnv?: boolean;
      metadata?: { logoUri?: string; tosUri?: string; policyUri?: string };
    };
    takos?: {
      scopes: string[];
    };
    resources?: Record<string, AppResource>;
    services: Record<string, AppService>;
    routes?: AppRoute[];
    mcpServers?: AppMcpServer[];
    fileHandlers?: AppFileHandler[];
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

// --- parsing utility helpers ---

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, field: string): string | undefined {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

export function asRequiredString(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((entry, index) => asRequiredString(entry, `${field}[${index}]`));
}

export function asStringMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[asRequiredString(key, `${field} key`)] = String(entry ?? '');
  }
  return out;
}

export function asOptionalInteger(value: unknown, field: string, options?: { min?: number }): number | undefined {
  if (value == null) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`${field} must be an integer`);
  }
  if (options?.min != null && numeric < options.min) {
    throw new Error(`${field} must be >= ${options.min}`);
  }
  return numeric;
}

export function normalizeRepoPath(path: string): string {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();
}

export function filterWorkflowErrors(diagnostics: WorkflowDiagnostic[]): WorkflowDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
}
