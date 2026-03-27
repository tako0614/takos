/**
 * Workers for Platforms (WFP) Service
 *
 * Manages tenant worker deployment, resource binding, and lifecycle.
 * Uses Cloudflare API to interact with dispatch namespaces.
 *
 * This file is a facade: domain logic lives in the per-resource modules
 * (workers.ts, d1.ts, r2.ts, kv.ts, queues.ts, vectorize.ts, orchestrator.ts).
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
import { BadRequestError } from '@takos/common/errors';

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


export class WFPService {
  private config: WFPConfig;
  private client: WfpClient;

  // Timeout for Cloudflare API calls (10 minutes)
  private static readonly API_TIMEOUT_MS = 600000;

  constructor(env: WfpEnv | WFPConfig) {
    this.config = 'accountId' in env ? env : createWfpConfig(env);
    this.client = new WfpClient(this.config);
  }

  // ---------------------------------------------------------------------------
  // Internal context – implements WfpContext for submodules
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

  private formatBinding(binding: WorkerBinding): Record<string, unknown> {
    switch (binding.type) {
      case 'plain_text':
        return { type: 'plain_text', name: binding.name, text: binding.text };
      case 'secret_text':
        return { type: 'secret_text', name: binding.name, text: binding.text };
      case 'd1':
        return { type: 'd1', name: binding.name, id: binding.database_id };
      case 'r2_bucket':
        return { type: 'r2_bucket', name: binding.name, bucket_name: binding.bucket_name };
      case 'kv_namespace':
        return { type: 'kv_namespace', name: binding.name, namespace_id: binding.namespace_id };
      case 'queue':
        return {
          type: 'queue',
          name: binding.name,
          ...(binding.queue_name ? { queue_name: binding.queue_name } : {}),
          ...(typeof binding.delivery_delay === 'number' ? { delivery_delay: binding.delivery_delay } : {}),
        };
      case 'analytics_engine':
        return {
          type: 'analytics_engine',
          name: binding.name,
          ...(binding.dataset ? { dataset: binding.dataset } : {}),
        };
      case 'workflow':
        return {
          type: 'workflow',
          name: binding.name,
          ...(binding.workflow_name ? { workflow_name: binding.workflow_name } : {}),
          ...(binding.class_name ? { class_name: binding.class_name } : {}),
          ...(binding.script_name ? { script_name: binding.script_name } : {}),
        };
      case 'vectorize':
        return { type: 'vectorize', name: binding.name, index_name: binding.index_name };
      case 'service':
        return { type: 'service', name: binding.name, service: binding.service, environment: binding.environment };
      case 'durable_object_namespace':
        return {
          type: 'durable_object_namespace',
          name: binding.name,
          class_name: binding.class_name,
          ...(binding.script_name ? { script_name: binding.script_name } : {}),
        };
      default:
        throw new BadRequestError(`Unknown binding type: ${binding.type}`);
    }
  }

  private formatBindingForUpdate(binding: WorkerBinding | CloudflareBindingRecord | Record<string, unknown>): Record<string, unknown> {
    if (!binding || typeof binding !== 'object') {
      throw new BadRequestError('Invalid worker binding for update: expected object');
    }

    const candidate = binding as Record<string, unknown>;
    const type = typeof candidate.type === 'string' ? candidate.type : '';
    const name = typeof candidate.name === 'string' ? candidate.name : '';

    switch (type) {
      case 'plain_text':
      case 'secret_text':
        if (!name) break;
        return {
          type,
          name,
          ...(typeof candidate.text === 'string' ? { text: candidate.text } : {}),
        };
      case 'd1': {
        if (!name) break;
        const databaseId = typeof candidate.database_id === 'string'
          ? candidate.database_id
          : typeof candidate.id === 'string'
            ? candidate.id
            : undefined;
        if (databaseId) {
          return { type: 'd1', name, id: databaseId };
        }
        break;
      }
      case 'r2_bucket':
        if (!name) break;
        return {
          type: 'r2_bucket',
          name,
          ...(typeof candidate.bucket_name === 'string' ? { bucket_name: candidate.bucket_name } : {}),
        };
      case 'kv_namespace':
        if (!name) break;
        return {
          type: 'kv_namespace',
          name,
          ...(typeof candidate.namespace_id === 'string' ? { namespace_id: candidate.namespace_id } : {}),
        };
      case 'queue':
        if (!name) break;
        return {
          type: 'queue',
          name,
          ...(typeof candidate.queue_name === 'string' ? { queue_name: candidate.queue_name } : {}),
          ...(typeof candidate.delivery_delay === 'number' ? { delivery_delay: candidate.delivery_delay } : {}),
        };
      case 'analytics_engine':
        if (!name) break;
        return {
          type: 'analytics_engine',
          name,
          ...(typeof candidate.dataset === 'string' ? { dataset: candidate.dataset } : {}),
        };
      case 'workflow':
        if (!name) break;
        return {
          type: 'workflow',
          name,
          ...(typeof candidate.workflow_name === 'string' ? { workflow_name: candidate.workflow_name } : {}),
          ...(typeof candidate.class_name === 'string' ? { class_name: candidate.class_name } : {}),
          ...(typeof candidate.script_name === 'string' ? { script_name: candidate.script_name } : {}),
        };
      case 'vectorize':
        if (!name) break;
        return {
          type: 'vectorize',
          name,
          ...(typeof candidate.index_name === 'string'
            ? { index_name: candidate.index_name }
            : typeof candidate.id === 'string'
              ? { index_name: candidate.id }
              : {}),
        };
      case 'service':
        if (!name) break;
        return {
          type: 'service',
          name,
          ...(typeof candidate.service === 'string' ? { service: candidate.service } : {}),
          ...(typeof candidate.environment === 'string' ? { environment: candidate.environment } : {}),
        };
      case 'durable_object_namespace':
        if (!name) break;
        return {
          type: 'durable_object_namespace',
          name,
          ...(typeof candidate.class_name === 'string' ? { class_name: candidate.class_name } : {}),
          ...(typeof candidate.script_name === 'string' ? { script_name: candidate.script_name } : {}),
        };
      default:
        break;
    }

    // Fail-open for unknown/unexpected binding shapes to avoid dropping data on settings PATCH.
    return {
      ...candidate,
      ...(type ? { type } : {}),
      ...(name ? { name } : {}),
    };
  }

  /** Lazily-built context object that submodules use to call into this instance. */
  private get ctx(): WfpContext {
    return {
      config: this.config,
      scriptPath: (w) => this.scriptPath(w),
      accountPath: (s) => this.accountPath(s),
      cfFetch: (p, o, t) => this.cfFetch(p, o, t),
      cfFetchWithRetry: (p, o, m, t) => this.cfFetchWithRetry(p, o, m, t),
      formatBinding: (b) => this.formatBinding(b),
      formatBindingForUpdate: (b) => this.formatBindingForUpdate(b),
    };
  }

  // ---------------------------------------------------------------------------
  // Worker CRUD  (delegated to workers.ts)
  // ---------------------------------------------------------------------------

  async createWorker(options: CreateWorkerOptions): Promise<void> {
    return workerOps.createWorker(this.ctx, options);
  }

  async createAssetsUploadSession(
    workerName: string,
    manifest: Record<string, AssetManifestEntry>
  ): Promise<AssetsUploadSession> {
    return workerOps.createWorkerAssetsUploadSession(this.client, this.config, workerName, manifest);
  }

  async uploadAssets(
    sessionJwt: string,
    files: Record<string, AssetUploadFile>
  ): Promise<string> {
    return workerOps.uploadWorkerAssets(this.config, sessionJwt, files);
  }

  async uploadAllAssets(
    workerName: string,
    files: Array<{ path: string; content: ArrayBuffer; contentType?: string }>
  ): Promise<string> {
    return workerOps.uploadAllWorkerAssets(this.client, this.config, workerName, files);
  }

  async deleteWorker(workerName: string): Promise<void> {
    return workerOps.deleteWorker(this.ctx, workerName);
  }

  async getWorker(workerName: string): Promise<unknown> {
    return workerOps.getWorker(this.ctx, workerName);
  }

  async workerExists(workerName: string): Promise<boolean> {
    return workerOps.workerExists(this.ctx, workerName);
  }

  async listWorkers(): Promise<Array<{
    id: string;
    script: string;
    created_on: string;
    modified_on: string;
  }>> {
    return workerOps.listWorkers(this.ctx);
  }

  async updateWorkerSettings(options: {
    workerName: string;
    bindings?: Array<WorkerBinding | CloudflareBindingRecord | Record<string, unknown>>;
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: {
      cpu_ms?: number;
      subrequests?: number;
    };
  }): Promise<void> {
    return workerOps.updateWorkerSettings(this.ctx, options);
  }

  async getWorkerSettings(workerName: string): Promise<{
    bindings: CloudflareBindingRecord[];
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  }> {
    return workerOps.getWorkerSettings(this.ctx, workerName);
  }

  async createWorkerWithWasm(
    workerName: string,
    workerScript: string,
    wasmContent: ArrayBuffer | null,
    options: {
      bindings: Array<{
        type: string;
        name: string;
        id?: string;
        bucket_name?: string;
        namespace_id?: string;
        queue_name?: string;
        delivery_delay?: number;
        dataset?: string;
        workflow_name?: string;
        class_name?: string;
        script_name?: string;
        index_name?: string;
        text?: string;
      }>;
      compatibility_date?: string;
      compatibility_flags?: string[];
      limits?: {
        cpu_ms?: number;
        subrequests?: number;
      };
      assetsJwt?: string;
    }
  ): Promise<void> {
    return workerOps.createWorkerWithWasm(this.ctx, workerName, workerScript, wasmContent, options);
  }

  // ---------------------------------------------------------------------------
  // D1  (delegated to d1.ts)
  // ---------------------------------------------------------------------------

  async createD1Database(name: string): Promise<string> {
    return d1Ops.createD1Database(this.ctx, name);
  }

  async deleteD1Database(databaseId: string): Promise<void> {
    return d1Ops.deleteD1Database(this.ctx, databaseId);
  }

  async runD1SQL(databaseId: string, sql: string): Promise<unknown> {
    return d1Ops.runD1SQL(this.ctx, databaseId, sql);
  }

  async listD1Tables(databaseId: string): Promise<Array<{ name: string }>> {
    return d1Ops.listD1Tables(this.ctx, databaseId);
  }

  async getD1TableInfo(databaseId: string, tableName: string): Promise<Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>> {
    return d1Ops.getD1TableInfo(this.ctx, databaseId, tableName);
  }

  async getD1TableCount(databaseId: string, tableName: string): Promise<number> {
    return d1Ops.getD1TableCount(this.ctx, databaseId, tableName);
  }

  async executeD1Query(databaseId: string, sql: string): Promise<unknown> {
    return d1Ops.executeD1Query(this.ctx, databaseId, sql);
  }

  async queryD1<T>(databaseId: string, sql: string): Promise<T[]> {
    return d1Ops.queryD1<T>(this.ctx, databaseId, sql);
  }

  // ---------------------------------------------------------------------------
  // R2  (delegated to r2.ts)
  // ---------------------------------------------------------------------------

  async createR2Bucket(name: string): Promise<void> {
    return r2Ops.createR2Bucket(this.ctx, name);
  }

  async deleteR2Bucket(name: string): Promise<void> {
    return r2Ops.deleteR2Bucket(this.ctx, name);
  }

  async listR2Objects(bucketName: string, options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    objects: Array<{
      key: string;
      size: number;
      uploaded: string;
      etag: string;
    }>;
    truncated: boolean;
    cursor?: string;
  }> {
    return r2Ops.listR2Objects(this.ctx, bucketName, options);
  }

  async uploadToR2(
    bucketName: string,
    key: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer | string,
    options?: {
      contentType?: string;
    }
  ): Promise<void> {
    return r2Ops.uploadToR2(this.ctx, bucketName, key, body, options);
  }

  async deleteR2Object(bucketName: string, key: string): Promise<void> {
    return r2Ops.deleteR2Object(this.ctx, bucketName, key);
  }

  async getR2BucketStats(bucketName: string): Promise<{
    objectCount: number;
    payloadSize: number;
    metadataSize: number;
  }> {
    return r2Ops.getR2BucketStats(this.ctx, bucketName);
  }

  // ---------------------------------------------------------------------------
  // KV  (delegated to kv.ts)
  // ---------------------------------------------------------------------------

  async createKVNamespace(title: string): Promise<string> {
    return kvOps.createKVNamespace(this.ctx, title);
  }

  async deleteKVNamespace(namespaceId: string): Promise<void> {
    return kvOps.deleteKVNamespace(this.ctx, namespaceId);
  }

  // ---------------------------------------------------------------------------
  // Queues  (delegated to queues.ts)
  // ---------------------------------------------------------------------------

  async createQueue(
    queueName: string,
    options?: { deliveryDelaySeconds?: number },
  ): Promise<{ id: string; name: string }> {
    return queueOps.createQueue(this.ctx, queueName, options);
  }

  async listQueues(): Promise<Array<{ id: string; name: string }>> {
    return queueOps.listQueues(this.ctx);
  }

  async deleteQueue(queueId: string): Promise<void> {
    return queueOps.deleteQueue(this.ctx, queueId);
  }

  async deleteQueueByName(queueName: string): Promise<void> {
    return queueOps.deleteQueueByName(this.ctx, queueName);
  }

  // ---------------------------------------------------------------------------
  // Vectorize  (delegated to vectorize.ts)
  // ---------------------------------------------------------------------------

  async createVectorizeIndex(
    name: string,
    config: { dimensions: number; metric: 'cosine' | 'euclidean' | 'dot-product' }
  ): Promise<string> {
    return vectorizeOps.createVectorizeIndex(this.ctx, name, config);
  }

  async deleteVectorizeIndex(name: string): Promise<void> {
    return vectorizeOps.deleteVectorizeIndex(this.ctx, name);
  }

  // ---------------------------------------------------------------------------
  // Deployment orchestration  (delegated to orchestrator.ts)
  // ---------------------------------------------------------------------------

  async deployWorkerWithBindings(
    workerName: string,
    options: {
      bindings: Array<{
        type: string;
        name: string;
        text?: string;
        id?: string;
        bucket_name?: string;
        namespace_id?: string;
        index_name?: string;
        queue_name?: string;
        delivery_delay?: number;
        dataset?: string;
        workflow_name?: string;
        class_name?: string;
        script_name?: string;
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
