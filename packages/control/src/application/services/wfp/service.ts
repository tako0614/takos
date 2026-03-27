/**
 * Workers for Platforms (WFP) Service
 *
 * Manages tenant worker deployment, resource binding, and lifecycle.
 * Uses Cloudflare API to interact with dispatch namespaces.
 *
 * This file is a facade: domain logic lives in the per-resource modules
 * (workers.ts, d1.ts, r2.ts, kv.ts, queues.ts, vectorize.ts, orchestrator.ts).
 * Binding formatting lives in bindings.ts.
 *
 * Each resource group is also accessible via a bound namespace property
 * (e.g. `wfp.workers.createWorker(...)`, `wfp.d1.createD1Database(...)`).
 * The flat methods are kept for backward compatibility.
 */

import type { WfpEnv } from './client';
import {
  WfpClient,
  createWfpConfig,
  resolveWfpConfig,
  type WFPConfig,
  type CFAPIResponse,
  type CloudflareAPIError,
} from './client';
import { logWarn } from '../../../shared/utils/logger';
import { formatBinding, formatBindingForUpdate } from './bindings';

// Re-export public types from their canonical locations
export type {
  WorkerBinding,
  CloudflareBindingRecord,
  CreateWorkerOptions,
} from './types';
export type {
  AssetManifestEntry,
  AssetUploadFile,
  AssetsUploadSession,
  AssetsUploadCompletion,
} from './assets';

// Re-export standalone functions
export { getTakosWorkerScript, getTakosMigrationSQL } from './orchestrator';

// Import types needed by the class
import type {
  WorkerBinding,
  CloudflareBindingRecord,
  CreateWorkerOptions,
  WfpContext,
} from './types';
import type {
  AssetManifestEntry,
  AssetUploadFile,
  AssetsUploadSession,
} from './assets';

// Import submodule functions
import * as workerOps from './workers';
import * as d1Ops from './d1';
import * as r2Ops from './r2';
import * as kvOps from './kv';
import * as queueOps from './queues';
import * as vectorizeOps from './vectorize';
import * as orchestratorOps from './orchestrator';

// Re-export the binding helpers for direct usage
export { formatBinding, formatBindingForUpdate } from './bindings';


export class WFPService {
  private config: WFPConfig;
  private client: WfpClient;

  // Timeout for Cloudflare API calls (10 minutes)
  private static readonly API_TIMEOUT_MS = 600000;

  // ---------------------------------------------------------------------------
  // Bound submodule namespaces
  // ---------------------------------------------------------------------------

  /** Worker CRUD operations. @see workers.ts */
  readonly workers: {
    createWorker(options: CreateWorkerOptions): Promise<void>;
    createAssetsUploadSession(workerName: string, manifest: Record<string, AssetManifestEntry>): Promise<AssetsUploadSession>;
    uploadAssets(sessionJwt: string, files: Record<string, AssetUploadFile>): Promise<string>;
    uploadAllAssets(workerName: string, files: Array<{ path: string; content: ArrayBuffer; contentType?: string }>): Promise<string>;
    deleteWorker(workerName: string): Promise<void>;
    getWorker(workerName: string): Promise<unknown>;
    workerExists(workerName: string): Promise<boolean>;
    listWorkers(): Promise<Array<{ id: string; script: string; created_on: string; modified_on: string }>>;
    updateWorkerSettings(options: {
      workerName: string;
      bindings?: Array<WorkerBinding | CloudflareBindingRecord | Record<string, unknown>>;
      compatibility_date?: string;
      compatibility_flags?: string[];
      limits?: { cpu_ms?: number; subrequests?: number };
    }): Promise<void>;
    getWorkerSettings(workerName: string): Promise<{
      bindings: CloudflareBindingRecord[];
      compatibility_date?: string;
      compatibility_flags?: string[];
      limits?: { cpu_ms?: number; subrequests?: number };
    }>;
    createWorkerWithWasm(
      workerName: string,
      workerScript: string,
      wasmContent: ArrayBuffer | null,
      options: {
        bindings: Array<{
          type: string; name: string; id?: string; bucket_name?: string; namespace_id?: string;
          queue_name?: string; delivery_delay?: number; dataset?: string; workflow_name?: string;
          class_name?: string; script_name?: string; index_name?: string; text?: string;
        }>;
        compatibility_date?: string;
        compatibility_flags?: string[];
        limits?: { cpu_ms?: number; subrequests?: number };
        assetsJwt?: string;
      }
    ): Promise<void>;
  };

  /** D1 database operations. @see d1.ts */
  readonly d1: {
    createD1Database(name: string): Promise<string>;
    deleteD1Database(databaseId: string): Promise<void>;
    runD1SQL(databaseId: string, sql: string): Promise<unknown>;
    listD1Tables(databaseId: string): Promise<Array<{ name: string }>>;
    getD1TableInfo(databaseId: string, tableName: string): Promise<Array<{
      cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number;
    }>>;
    getD1TableCount(databaseId: string, tableName: string): Promise<number>;
    executeD1Query(databaseId: string, sql: string): Promise<unknown>;
    queryD1<T>(databaseId: string, sql: string): Promise<T[]>;
  };

  /** R2 bucket operations. @see r2.ts */
  readonly r2: {
    createR2Bucket(name: string): Promise<void>;
    deleteR2Bucket(name: string): Promise<void>;
    listR2Objects(bucketName: string, options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
      objects: Array<{ key: string; size: number; uploaded: string; etag: string }>;
      truncated: boolean;
      cursor?: string;
    }>;
    uploadToR2(bucketName: string, key: string, body: ReadableStream<Uint8Array> | ArrayBuffer | string, options?: { contentType?: string }): Promise<void>;
    deleteR2Object(bucketName: string, key: string): Promise<void>;
    getR2BucketStats(bucketName: string): Promise<{ objectCount: number; payloadSize: number; metadataSize: number }>;
  };

  /** KV namespace operations. @see kv.ts */
  readonly kv: {
    createKVNamespace(title: string): Promise<string>;
    deleteKVNamespace(namespaceId: string): Promise<void>;
  };

  /** Queue operations. @see queues.ts */
  readonly queues: {
    createQueue(queueName: string, options?: { deliveryDelaySeconds?: number }): Promise<{ id: string; name: string }>;
    listQueues(): Promise<Array<{ id: string; name: string }>>;
    deleteQueue(queueId: string): Promise<void>;
    deleteQueueByName(queueName: string): Promise<void>;
  };

  /** Vectorize index operations. @see vectorize.ts */
  readonly vectorize: {
    createVectorizeIndex(name: string, config: { dimensions: number; metric: 'cosine' | 'euclidean' | 'dot-product' }): Promise<string>;
    deleteVectorizeIndex(name: string): Promise<void>;
  };

  constructor(env: WfpEnv | WFPConfig) {
    this.config = 'accountId' in env ? env : createWfpConfig(env);
    this.client = new WfpClient(this.config);

    // Bind submodule namespaces eagerly so callers can destructure them.
    // All methods capture `this` via arrow functions.
    this.workers = {
      createWorker: (options) => workerOps.createWorker(this.ctx, options),
      createAssetsUploadSession: (workerName, manifest) => workerOps.createWorkerAssetsUploadSession(this.client, this.config, workerName, manifest),
      uploadAssets: (sessionJwt, files) => workerOps.uploadWorkerAssets(this.config, sessionJwt, files),
      uploadAllAssets: (workerName, files) => workerOps.uploadAllWorkerAssets(this.client, this.config, workerName, files),
      deleteWorker: (workerName) => workerOps.deleteWorker(this.ctx, workerName),
      getWorker: (workerName) => workerOps.getWorker(this.ctx, workerName),
      workerExists: (workerName) => workerOps.workerExists(this.ctx, workerName),
      listWorkers: () => workerOps.listWorkers(this.ctx),
      updateWorkerSettings: (options) => workerOps.updateWorkerSettings(this.ctx, options),
      getWorkerSettings: (workerName) => workerOps.getWorkerSettings(this.ctx, workerName),
      createWorkerWithWasm: (workerName, workerScript, wasmContent, options) =>
        workerOps.createWorkerWithWasm(this.ctx, workerName, workerScript, wasmContent, options),
    };

    this.d1 = {
      createD1Database: (name) => d1Ops.createD1Database(this.ctx, name),
      deleteD1Database: (databaseId) => d1Ops.deleteD1Database(this.ctx, databaseId),
      runD1SQL: (databaseId, sql) => d1Ops.runD1SQL(this.ctx, databaseId, sql),
      listD1Tables: (databaseId) => d1Ops.listD1Tables(this.ctx, databaseId),
      getD1TableInfo: (databaseId, tableName) => d1Ops.getD1TableInfo(this.ctx, databaseId, tableName),
      getD1TableCount: (databaseId, tableName) => d1Ops.getD1TableCount(this.ctx, databaseId, tableName),
      executeD1Query: (databaseId, sql) => d1Ops.executeD1Query(this.ctx, databaseId, sql),
      queryD1: <T>(databaseId: string, sql: string) => d1Ops.queryD1<T>(this.ctx, databaseId, sql),
    };

    this.r2 = {
      createR2Bucket: (name) => r2Ops.createR2Bucket(this.ctx, name),
      deleteR2Bucket: (name) => r2Ops.deleteR2Bucket(this.ctx, name),
      listR2Objects: (bucketName, options) => r2Ops.listR2Objects(this.ctx, bucketName, options),
      uploadToR2: (bucketName, key, body, options) => r2Ops.uploadToR2(this.ctx, bucketName, key, body, options),
      deleteR2Object: (bucketName, key) => r2Ops.deleteR2Object(this.ctx, bucketName, key),
      getR2BucketStats: (bucketName) => r2Ops.getR2BucketStats(this.ctx, bucketName),
    };

    this.kv = {
      createKVNamespace: (title) => kvOps.createKVNamespace(this.ctx, title),
      deleteKVNamespace: (namespaceId) => kvOps.deleteKVNamespace(this.ctx, namespaceId),
    };

    this.queues = {
      createQueue: (queueName, options) => queueOps.createQueue(this.ctx, queueName, options),
      listQueues: () => queueOps.listQueues(this.ctx),
      deleteQueue: (queueId) => queueOps.deleteQueue(this.ctx, queueId),
      deleteQueueByName: (queueName) => queueOps.deleteQueueByName(this.ctx, queueName),
    };

    this.vectorize = {
      createVectorizeIndex: (name, config) => vectorizeOps.createVectorizeIndex(this.ctx, name, config),
      deleteVectorizeIndex: (name) => vectorizeOps.deleteVectorizeIndex(this.ctx, name),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal context -- implements WfpContext for submodules
  // ---------------------------------------------------------------------------

  /** Build the dispatch namespace script path for a given worker */
  private scriptPath(workerName: string): string {
    return `/accounts/${this.config.accountId}/workers/dispatch/namespaces/${this.config.dispatchNamespace}/scripts/${workerName}`;
  }

  /** Build an account-scoped API path */
  private accountPath(suffix: string): string {
    return `/accounts/${this.config.accountId}${suffix}`;
  }

  /**
   * Low-level fetch with error classification
   */
  private async cfFetch<T>(
    path: string,
    options: RequestInit = {},
    timeoutMs: number = WFPService.API_TIMEOUT_MS
  ): Promise<CFAPIResponse<T>> {
    return this.client.fetch<T>(path, options, timeoutMs);
  }

  /**
   * Fetch with automatic retry for transient errors.
   * Uses exponential backoff and respects Retry-After header.
   */
  private async cfFetchWithRetry<T>(
    path: string,
    options: RequestInit = {},
    maxRetries: number = 3,
    timeoutMs: number = WFPService.API_TIMEOUT_MS
  ): Promise<CFAPIResponse<T>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.cfFetch<T>(path, options, timeoutMs);
      } catch (error) {
        lastError = error as Error;
        const cfError = error as CloudflareAPIError;

        if (!cfError.isRetryable) {
          throw error;
        }

        if (attempt >= maxRetries - 1) {
          break;
        }

        const baseDelay = cfError.retryAfter
          ? cfError.retryAfter * 1000
          : Math.pow(2, attempt) * 1000;

        const jitter = Math.random() * 500;
        const delay = Math.min(baseDelay + jitter, 60000);

        logWarn(`Cloudflare API request failed (attempt ${attempt + 1}/${maxRetries}), ` +
          `retrying in ${Math.round(delay / 1000)}s: ${cfError.message}`, { module: 'services/wfp/service' });

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /** Lazily-built context object that submodules use to call into this instance. */
  private get ctx(): WfpContext {
    return {
      config: this.config,
      scriptPath: (w) => this.scriptPath(w),
      accountPath: (s) => this.accountPath(s),
      cfFetch: (p, o, t) => this.cfFetch(p, o, t),
      cfFetchWithRetry: (p, o, m, t) => this.cfFetchWithRetry(p, o, m, t),
      formatBinding: (b) => formatBinding(b),
      formatBindingForUpdate: (b) => formatBindingForUpdate(b),
    };
  }

  // ---------------------------------------------------------------------------
  // Flat methods -- kept for backward compatibility; delegate to namespace properties
  // ---------------------------------------------------------------------------

  /** @see workers.createWorker */
  createWorker(options: CreateWorkerOptions): Promise<void> { return this.workers.createWorker(options); }
  /** @see workers.createAssetsUploadSession */
  createAssetsUploadSession(workerName: string, manifest: Record<string, AssetManifestEntry>): Promise<AssetsUploadSession> { return this.workers.createAssetsUploadSession(workerName, manifest); }
  /** @see workers.uploadAssets */
  uploadAssets(sessionJwt: string, files: Record<string, AssetUploadFile>): Promise<string> { return this.workers.uploadAssets(sessionJwt, files); }
  /** @see workers.uploadAllAssets */
  uploadAllAssets(workerName: string, files: Array<{ path: string; content: ArrayBuffer; contentType?: string }>): Promise<string> { return this.workers.uploadAllAssets(workerName, files); }
  /** @see workers.deleteWorker */
  deleteWorker(workerName: string): Promise<void> { return this.workers.deleteWorker(workerName); }
  /** @see workers.getWorker */
  getWorker(workerName: string): Promise<unknown> { return this.workers.getWorker(workerName); }
  /** @see workers.workerExists */
  workerExists(workerName: string): Promise<boolean> { return this.workers.workerExists(workerName); }
  /** @see workers.listWorkers */
  listWorkers(): Promise<Array<{ id: string; script: string; created_on: string; modified_on: string }>> { return this.workers.listWorkers(); }
  /** @see workers.updateWorkerSettings */
  updateWorkerSettings(options: {
    workerName: string;
    bindings?: Array<WorkerBinding | CloudflareBindingRecord | Record<string, unknown>>;
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  }): Promise<void> { return this.workers.updateWorkerSettings(options); }
  /** @see workers.getWorkerSettings */
  getWorkerSettings(workerName: string): Promise<{
    bindings: CloudflareBindingRecord[];
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  }> { return this.workers.getWorkerSettings(workerName); }
  /** @see workers.createWorkerWithWasm */
  createWorkerWithWasm(
    workerName: string, workerScript: string, wasmContent: ArrayBuffer | null,
    options: {
      bindings: Array<{ type: string; name: string; id?: string; bucket_name?: string; namespace_id?: string; queue_name?: string; delivery_delay?: number; dataset?: string; workflow_name?: string; class_name?: string; script_name?: string; index_name?: string; text?: string; }>;
      compatibility_date?: string; compatibility_flags?: string[]; limits?: { cpu_ms?: number; subrequests?: number }; assetsJwt?: string;
    }
  ): Promise<void> { return this.workers.createWorkerWithWasm(workerName, workerScript, wasmContent, options); }

  // D1 flat methods  @see d1.ts
  /** @see d1.createD1Database */
  createD1Database(name: string): Promise<string> { return this.d1.createD1Database(name); }
  /** @see d1.deleteD1Database */
  deleteD1Database(databaseId: string): Promise<void> { return this.d1.deleteD1Database(databaseId); }
  /** @see d1.runD1SQL */
  runD1SQL(databaseId: string, sql: string): Promise<unknown> { return this.d1.runD1SQL(databaseId, sql); }
  /** @see d1.listD1Tables */
  listD1Tables(databaseId: string): Promise<Array<{ name: string }>> { return this.d1.listD1Tables(databaseId); }
  /** @see d1.getD1TableInfo */
  getD1TableInfo(databaseId: string, tableName: string): Promise<Array<{ cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number; }>> { return this.d1.getD1TableInfo(databaseId, tableName); }
  /** @see d1.getD1TableCount */
  getD1TableCount(databaseId: string, tableName: string): Promise<number> { return this.d1.getD1TableCount(databaseId, tableName); }
  /** @see d1.executeD1Query */
  executeD1Query(databaseId: string, sql: string): Promise<unknown> { return this.d1.executeD1Query(databaseId, sql); }
  /** @see d1.queryD1 */
  queryD1<T>(databaseId: string, sql: string): Promise<T[]> { return this.d1.queryD1<T>(databaseId, sql); }

  // R2 flat methods  @see r2.ts
  /** @see r2.createR2Bucket */
  createR2Bucket(name: string): Promise<void> { return this.r2.createR2Bucket(name); }
  /** @see r2.deleteR2Bucket */
  deleteR2Bucket(name: string): Promise<void> { return this.r2.deleteR2Bucket(name); }
  /** @see r2.listR2Objects */
  listR2Objects(bucketName: string, options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string; size: number; uploaded: string; etag: string }>; truncated: boolean; cursor?: string }> { return this.r2.listR2Objects(bucketName, options); }
  /** @see r2.uploadToR2 */
  uploadToR2(bucketName: string, key: string, body: ReadableStream<Uint8Array> | ArrayBuffer | string, options?: { contentType?: string }): Promise<void> { return this.r2.uploadToR2(bucketName, key, body, options); }
  /** @see r2.deleteR2Object */
  deleteR2Object(bucketName: string, key: string): Promise<void> { return this.r2.deleteR2Object(bucketName, key); }
  /** @see r2.getR2BucketStats */
  getR2BucketStats(bucketName: string): Promise<{ objectCount: number; payloadSize: number; metadataSize: number }> { return this.r2.getR2BucketStats(bucketName); }

  // KV flat methods  @see kv.ts
  /** @see kv.createKVNamespace */
  createKVNamespace(title: string): Promise<string> { return this.kv.createKVNamespace(title); }
  /** @see kv.deleteKVNamespace */
  deleteKVNamespace(namespaceId: string): Promise<void> { return this.kv.deleteKVNamespace(namespaceId); }

  // Queue flat methods  @see queues.ts
  /** @see queues.createQueue */
  createQueue(queueName: string, options?: { deliveryDelaySeconds?: number }): Promise<{ id: string; name: string }> { return this.queues.createQueue(queueName, options); }
  /** @see queues.listQueues */
  listQueues(): Promise<Array<{ id: string; name: string }>> { return this.queues.listQueues(); }
  /** @see queues.deleteQueue */
  deleteQueue(queueId: string): Promise<void> { return this.queues.deleteQueue(queueId); }
  /** @see queues.deleteQueueByName */
  deleteQueueByName(queueName: string): Promise<void> { return this.queues.deleteQueueByName(queueName); }

  // Vectorize flat methods  @see vectorize.ts
  /** @see vectorize.createVectorizeIndex */
  createVectorizeIndex(name: string, config: { dimensions: number; metric: 'cosine' | 'euclidean' | 'dot-product' }): Promise<string> { return this.vectorize.createVectorizeIndex(name, config); }
  /** @see vectorize.deleteVectorizeIndex */
  deleteVectorizeIndex(name: string): Promise<void> { return this.vectorize.deleteVectorizeIndex(name); }

  // ---------------------------------------------------------------------------
  // Deployment orchestration  (delegated to orchestrator.ts)
  // ---------------------------------------------------------------------------

  async deployWorkerWithBindings(
    workerName: string,
    options: {
      bindings: Array<{
        type: string; name: string; text?: string; id?: string; bucket_name?: string;
        namespace_id?: string; index_name?: string; queue_name?: string; delivery_delay?: number;
        dataset?: string; workflow_name?: string; class_name?: string; script_name?: string;
      }>;
      bundleUrl?: string;
      bundleScript?: string;
      compatibilityDate?: string;
      compatibilityFlags?: string[];
      assetsJwt?: string;
    }
  ): Promise<void> {
    return orchestratorOps.deployWorkerWithBindings(
      this.ctx,
      (opts) => this.createWorker(opts),
      workerName,
      options
    );
  }
}

export function createWfpService(env: WfpEnv): WFPService | null {
  const config = resolveWfpConfig(env);
  return config ? new WFPService(config) : null;
}
