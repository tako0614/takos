/**
 * Shared types for the Cloudflare provider adapter submodules.
 *
 * The Cloudflare provider adapter manages per-tenant runtimes inside a
 * dispatch namespace. Each tenant gets an isolated runtime with individually
 * assigned SQL, object-store, KV, message-queue, vector-search, and related
 * resource bindings.
 *
 * These types define the internal contract between the facade (service.ts) and
 * the per-domain method modules.  They are NOT part of the public API.
 */

import type { CFAPIResponse, WFPConfig } from "./client.ts";

// ---------------------------------------------------------------------------
// Binding types (public - re-exported from service.ts / index.ts)
// ---------------------------------------------------------------------------

export interface WorkerBinding {
  type:
    | "plain_text"
    | "secret_text"
    | "d1"
    | "r2_bucket"
    | "kv_namespace"
    | "queue"
    | "analytics_engine"
    | "workflow"
    | "vectorize"
    | "service"
    | "durable_object_namespace";
  name: string;
  text?: string;
  database_id?: string;
  bucket_name?: string;
  namespace_id?: string;
  queue_name?: string;
  queue_backend?: "sqs" | "pubsub" | "redis" | "persistent";
  queue_url?: string;
  subscription_name?: string;
  backend_name?: string;
  delivery_delay?: number;
  dataset?: string;
  workflow_name?: string;
  class_name?: string;
  script_name?: string;
  index_name?: string;
  service?: string;
  environment?: string;
}

/** Shape returned by the Cloudflare API GET /settings endpoint for bindings */
export interface CloudflareBindingRecord {
  type: string;
  name: string;
  text?: string;
  id?: string;
  database_id?: string;
  bucket_name?: string;
  namespace_id?: string;
  queue_name?: string;
  queue_backend?: "sqs" | "pubsub" | "redis" | "persistent";
  queue_url?: string;
  subscription_name?: string;
  backend_name?: string;
  delivery_delay?: number;
  dataset?: string;
  workflow_name?: string;
  class_name?: string;
  script_name?: string;
  index_name?: string;
  service?: string;
  environment?: string;
}

export interface WorkerContainerMetadata {
  class_name: string;
  image: string;
  instance_type?: string;
  max_instances?: number;
  name?: string;
  image_build_context?: string;
  image_vars?: Record<string, string>;
  rollout_active_grace_period?: number;
  rollout_step_percentage?: number | number[];
}

export interface WorkerMigrationMetadata {
  tag: string;
  new_classes?: string[];
  new_sqlite_classes?: string[];
}

export interface WorkerActorMigrationsMetadata {
  old_tag?: string;
  new_tag: string;
  steps: Array<{
    new_classes?: string[];
    new_sqlite_classes?: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Internal helper context passed to submodules
// ---------------------------------------------------------------------------

/**
 * Subset of WFPService internals exposed to mixin modules so they can call the
 * Cloudflare API without depending on the full class.
 */
export interface WfpContext {
  readonly config: WFPConfig;
  scriptPath(workerName: string): string;
  accountPath(suffix: string): string;
  cfFetch<T>(
    path: string,
    options?: RequestInit,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<CFAPIResponse<T>>;
  cfFetchWithRetry<T>(
    path: string,
    options?: RequestInit,
    maxRetries?: number,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<CFAPIResponse<T>>;
  formatBinding(binding: WorkerBinding): Record<string, unknown>;
  formatBindingForUpdate(
    binding: WorkerBinding | CloudflareBindingRecord | Record<string, unknown>,
  ): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Option bags
// ---------------------------------------------------------------------------

export interface CreateWorkerOptions {
  workerName: string;
  workerScript: string;
  bindings: WorkerBinding[];
  compatibility_date?: string;
  compatibility_flags?: string[];
  limits?: {
    cpu_ms?: number;
    subrequests?: number;
  };
  containers?: WorkerContainerMetadata[];
  migrations?: WorkerMigrationMetadata[];
  /** JWT from assets upload completion (for static assets) */
  assetsJwt?: string;
  /**
   * Optional caller signal. When aborted mid-call, the underlying Cloudflare
   * HTTP fetch is torn down via {@link WfpFetchOptions} (composed into the
   * fetch `AbortSignal` by {@link WfpClient.fetch}) and retries stop.
   */
  signal?: AbortSignal;
}

/** Result shape returned by the provider SQL query API */
export interface D1QueryResult<T> {
  results: T[];
}
