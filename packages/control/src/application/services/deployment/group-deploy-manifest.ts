/**
 * Minimal AppManifest type mirror for group-deploy.
 *
 * The canonical parser lives in `apps/cli/src/lib/app-manifest.ts`.
 * This file re-declares the shape so that `packages/control` can depend
 * on it without pulling in CLI-specific imports (commander, ora, etc.).
 *
 * Keep this in sync with the CLI's AppManifest type.
 */

export type AppResourceType =
  | "d1"
  | "r2"
  | "kv"
  | "secretRef"
  | "queue"
  | "vectorize"
  | "analyticsEngine"
  | "workflow"
  | "durableObject";

interface AppResourceBase {
  binding?: string;
  /** For secretRef: whether to auto-generate a random value */
  generate?: boolean;
}

interface D1Resource extends AppResourceBase {
  type: "d1";
  migrations?: string | { up: string; down: string };
}

interface R2Resource extends AppResourceBase {
  type: "r2";
}
interface KVResource extends AppResourceBase {
  type: "kv";
}
interface SecretRefResource extends AppResourceBase {
  type: "secretRef";
}

interface VectorizeResource extends AppResourceBase {
  type: "vectorize";
  /** For vectorize: index configuration */
  vectorize: { dimensions: number; metric: string };
}

interface QueueResource extends AppResourceBase {
  type: "queue";
  /** For queue: queue configuration */
  queue?: { maxRetries?: number; deadLetterQueue?: string };
}

interface AnalyticsEngineResource extends AppResourceBase {
  type: "analyticsEngine";
}
interface WorkflowResource extends AppResourceBase {
  type: "workflow";
}
interface DurableObjectResource extends AppResourceBase {
  type: "durableObject";
}

export type AppResource =
  | D1Resource
  | R2Resource
  | KVResource
  | SecretRefResource
  | VectorizeResource
  | QueueResource
  | AnalyticsEngineResource
  | WorkflowResource
  | DurableObjectResource;

export interface WorkerServiceBuild {
  fromWorkflow: {
    path: string;
    job: string;
    artifact: string;
    artifactPath: string;
  };
}

export interface WorkerService {
  type: "worker";
  build: WorkerServiceBuild;
  env?: Record<string, string>;
  bindings?: {
    d1?: string[];
    r2?: string[];
    kv?: string[];
    services?: string[];
    queues?: string[];
    vectorize?: string[];
  };
}

export interface AppRoute {
  name?: string;
  target: string;
  path?: string;
  ingress?: string;
  timeoutMs?: number;
}

export interface AppManifest {
  apiVersion: "takos.dev/v1alpha1";
  kind: "App";
  metadata: {
    name: string;
    appId?: string;
  };
  spec: {
    version: string;
    description?: string;
    icon?: string;
    category?: string;
    tags?: string[];
    capabilities?: string[];
    env?: {
      required?: string[];
    };
    resources?: Record<string, AppResource>;
    workers?: Record<string, WorkerService>;
    routes?: AppRoute[];
  };
}
