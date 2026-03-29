/**
 * Workers for Platforms (WFP) Service
 *
 * Manages tenant worker deployment, resource binding, and lifecycle.
 * Uses Cloudflare API to interact with dispatch namespaces.
 *
 * Domain logic lives in the per-resource modules (workers.ts, d1.ts, r2.ts,
 * kv.ts, queues.ts, vectorize.ts, orchestrator.ts). This file provides a
 * thin factory that wires them together with a shared WfpContext.
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
} from './wfp-contracts';
export type {
  AssetManifestEntry,
  AssetUploadFile,
  AssetsUploadSession,
  AssetsUploadCompletion,
} from './assets';

// Re-export standalone functions
export { getTakosWorkerScript, getTakosMigrationSQL } from './orchestrator';

// Re-export the binding helpers for direct usage
export { formatBinding, formatBindingForUpdate } from './bindings';

// Import types needed by the factory
import type { WfpContext } from './wfp-contracts';

// Import submodule functions
import * as workerOps from './workers';
import * as d1Ops from './d1';
import * as r2Ops from './r2';
import * as kvOps from './kv';
import * as queueOps from './queues';
import * as vectorizeOps from './vectorize';
import * as orchestratorOps from './orchestrator';

// ---------------------------------------------------------------------------
// Internal: context construction
// ---------------------------------------------------------------------------

/** Timeout for Cloudflare API calls (10 minutes) */
const API_TIMEOUT_MS = 600000;

function buildWfpContext(config: WFPConfig, client: WfpClient): WfpContext {
  function scriptPath(workerName: string): string {
    return `/accounts/${config.accountId}/workers/dispatch/namespaces/${config.dispatchNamespace}/scripts/${workerName}`;
  }

  function accountPath(suffix: string): string {
    return `/accounts/${config.accountId}${suffix}`;
  }

  async function cfFetch<T>(
    path: string,
    options: RequestInit = {},
    timeoutMs: number = API_TIMEOUT_MS,
  ): Promise<CFAPIResponse<T>> {
    return client.fetch<T>(path, options, timeoutMs);
  }

  async function cfFetchWithRetry<T>(
    path: string,
    options: RequestInit = {},
    maxRetries: number = 3,
    timeoutMs: number = API_TIMEOUT_MS,
  ): Promise<CFAPIResponse<T>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await cfFetch<T>(path, options, timeoutMs);
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

        logWarn(
          `Cloudflare API request failed (attempt ${attempt + 1}/${maxRetries}), ` +
            `retrying in ${Math.round(delay / 1000)}s: ${cfError.message}`,
          { module: 'services/wfp/service' },
        );

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  return {
    config,
    scriptPath,
    accountPath,
    cfFetch,
    cfFetchWithRetry,
    formatBinding: (b) => formatBinding(b),
    formatBindingForUpdate: (b) => formatBindingForUpdate(b),
  };
}

// ---------------------------------------------------------------------------
// Bound namespace helpers
// ---------------------------------------------------------------------------

/**
 * Create a set of submodule namespaces where every function is pre-bound
 * to the given WfpContext, so callers never need to pass `ctx` explicitly.
 */
function bindSubmodules(ctx: WfpContext, config: WFPConfig, client: WfpClient) {
  return {
    workers: {
      createWorker: (options: Parameters<typeof workerOps.createWorker>[1]) =>
        workerOps.createWorker(ctx, options),
      createWorkerAssetsUploadSession: (
        workerName: Parameters<typeof workerOps.createWorkerAssetsUploadSession>[2],
        manifest: Parameters<typeof workerOps.createWorkerAssetsUploadSession>[3],
      ) => workerOps.createWorkerAssetsUploadSession(client, config, workerName, manifest),
      uploadWorkerAssets: (
        sessionJwt: Parameters<typeof workerOps.uploadWorkerAssets>[1],
        files: Parameters<typeof workerOps.uploadWorkerAssets>[2],
      ) => workerOps.uploadWorkerAssets(config, sessionJwt, files),
      uploadAllWorkerAssets: (
        workerName: Parameters<typeof workerOps.uploadAllWorkerAssets>[2],
        files: Parameters<typeof workerOps.uploadAllWorkerAssets>[3],
      ) => workerOps.uploadAllWorkerAssets(client, config, workerName, files),
      deleteWorker: (workerName: string) => workerOps.deleteWorker(ctx, workerName),
      getWorker: (workerName: string) => workerOps.getWorker(ctx, workerName),
      workerExists: (workerName: string) => workerOps.workerExists(ctx, workerName),
      listWorkers: () => workerOps.listWorkers(ctx),
      updateWorkerSettings: (options: Parameters<typeof workerOps.updateWorkerSettings>[1]) =>
        workerOps.updateWorkerSettings(ctx, options),
      getWorkerSettings: (workerName: string) => workerOps.getWorkerSettings(ctx, workerName),
      createWorkerWithWasm: (
        workerName: Parameters<typeof workerOps.createWorkerWithWasm>[1],
        workerScript: Parameters<typeof workerOps.createWorkerWithWasm>[2],
        wasmContent: Parameters<typeof workerOps.createWorkerWithWasm>[3],
        options: Parameters<typeof workerOps.createWorkerWithWasm>[4],
      ) => workerOps.createWorkerWithWasm(ctx, workerName, workerScript, wasmContent, options),
    },
    d1: {
      createD1Database: (name: string) => d1Ops.createD1Database(ctx, name),
      deleteD1Database: (databaseId: string) => d1Ops.deleteD1Database(ctx, databaseId),
      runD1SQL: (databaseId: string, sql: string) => d1Ops.runD1SQL(ctx, databaseId, sql),
      listD1Tables: (databaseId: string) => d1Ops.listD1Tables(ctx, databaseId),
      getD1TableInfo: (databaseId: string, tableName: string) =>
        d1Ops.getD1TableInfo(ctx, databaseId, tableName),
      getD1TableCount: (databaseId: string, tableName: string) =>
        d1Ops.getD1TableCount(ctx, databaseId, tableName),
      executeD1Query: (databaseId: string, sql: string) =>
        d1Ops.executeD1Query(ctx, databaseId, sql),
      queryD1: <T>(databaseId: string, sql: string) => d1Ops.queryD1<T>(ctx, databaseId, sql),
    },
    r2: {
      createR2Bucket: (name: string) => r2Ops.createR2Bucket(ctx, name),
      deleteR2Bucket: (name: string) => r2Ops.deleteR2Bucket(ctx, name),
      listR2Objects: (
        bucketName: string,
        options?: Parameters<typeof r2Ops.listR2Objects>[2],
      ) => r2Ops.listR2Objects(ctx, bucketName, options),
      uploadToR2: (
        bucketName: string,
        key: string,
        body: Parameters<typeof r2Ops.uploadToR2>[3],
        options?: Parameters<typeof r2Ops.uploadToR2>[4],
      ) => r2Ops.uploadToR2(ctx, bucketName, key, body, options),
      deleteR2Object: (bucketName: string, key: string) =>
        r2Ops.deleteR2Object(ctx, bucketName, key),
      getR2BucketStats: (bucketName: string) => r2Ops.getR2BucketStats(ctx, bucketName),
    },
    kv: {
      createKVNamespace: (title: string) => kvOps.createKVNamespace(ctx, title),
      deleteKVNamespace: (namespaceId: string) => kvOps.deleteKVNamespace(ctx, namespaceId),
    },
    queues: {
      createQueue: (queueName: string, options?: Parameters<typeof queueOps.createQueue>[2]) =>
        queueOps.createQueue(ctx, queueName, options),
      listQueues: () => queueOps.listQueues(ctx),
      deleteQueue: (queueId: string) => queueOps.deleteQueue(ctx, queueId),
      deleteQueueByName: (queueName: string) => queueOps.deleteQueueByName(ctx, queueName),
    },
    vectorize: {
      createVectorizeIndex: (
        name: string,
        vecConfig: Parameters<typeof vectorizeOps.createVectorizeIndex>[2],
      ) => vectorizeOps.createVectorizeIndex(ctx, name, vecConfig),
      deleteVectorizeIndex: (name: string) => vectorizeOps.deleteVectorizeIndex(ctx, name),
    },
  } as const;
}

// ---------------------------------------------------------------------------
// WFPService class -- kept for backward compatibility but now minimal
// ---------------------------------------------------------------------------

/**
 * WFP service facade.
 *
 * Thin wrapper that constructs a {@link WfpContext} and exposes context-bound
 * submodule namespaces. All domain logic lives in the per-resource modules.
 */
export class WFPService {
  readonly workers;
  readonly d1;
  readonly r2;
  readonly kv;
  readonly queues;
  readonly vectorize;

  private readonly ctx: WfpContext;

  constructor(env: WfpEnv | WFPConfig) {
    const config: WFPConfig = 'accountId' in env ? env : createWfpConfig(env);
    const client = new WfpClient(config);
    this.ctx = buildWfpContext(config, client);

    const bound = bindSubmodules(this.ctx, config, client);
    this.workers = bound.workers;
    this.d1 = bound.d1;
    this.r2 = bound.r2;
    this.kv = bound.kv;
    this.queues = bound.queues;
    this.vectorize = bound.vectorize;
  }

  // -------------------------------------------------------------------------
  // Deployment orchestration (delegated to orchestrator.ts)
  // -------------------------------------------------------------------------

  async deployWorkerWithBindings(
    workerName: string,
    options: Parameters<typeof orchestratorOps.deployWorkerWithBindings>[3],
  ): Promise<void> {
    return orchestratorOps.deployWorkerWithBindings(
      this.ctx,
      (opts) => this.workers.createWorker(opts),
      workerName,
      options,
    );
  }
}

export function createWfpService(env: WfpEnv): WFPService | null {
  const config = resolveWfpConfig(env);
  return config ? new WFPService(config) : null;
}
