/**
 * Worker CRUD methods for the WFP (Workers for Platforms) service.
 *
 * Handles creation, deletion, listing, existence checks, settings management,
 * and WASM-module deployment of tenant workers within a Cloudflare dispatch
 * namespace. Also provides static-asset upload helpers that delegate to
 * assets.ts.
 */

import type { WfpClient } from './client';
import type { WFPConfig } from './client';
import type {
  AssetManifestEntry,
  AssetUploadFile,
  AssetsUploadSession,
} from './assets';
import {
  createAssetsUploadSession,
  uploadAssets,
  uploadAllAssets,
} from './assets';
import type {
  WfpContext,
  WorkerBinding,
  CloudflareBindingRecord,
  CreateWorkerOptions,
} from './wfp-contracts';
import { buildWorkerMetadata } from './worker-metadata';

// ---------------------------------------------------------------------------
// Worker CRUD
// ---------------------------------------------------------------------------

/**
 * Create or update a worker in the dispatch namespace.
 */
export async function createWorker(ctx: WfpContext, options: CreateWorkerOptions): Promise<void> {
  const { workerName, workerScript, bindings, compatibility_date, compatibility_flags, limits, assetsJwt } = options;

  const metadata = buildWorkerMetadata({
    bindings: bindings.map(b => ctx.formatBinding(b)),
    compatibility_date,
    compatibility_flags,
    limits,
    assetsJwt,
  });

  const formData = new FormData();
  formData.append('worker.js', new Blob([workerScript], { type: 'application/javascript+module' }), 'worker.js');
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));

  await ctx.cfFetchWithRetry(
    ctx.scriptPath(workerName),
    {
      method: 'PUT',
      body: formData,
    }
  );
}

/**
 * Create an assets upload session for a worker.
 */
export async function createWorkerAssetsUploadSession(
  client: WfpClient,
  config: WFPConfig,
  workerName: string,
  manifest: Record<string, AssetManifestEntry>
): Promise<AssetsUploadSession> {
  return createAssetsUploadSession(client, config, workerName, manifest);
}

/**
 * Upload asset files using the session JWT.
 */
export async function uploadWorkerAssets(
  config: WFPConfig,
  sessionJwt: string,
  files: Record<string, AssetUploadFile>
): Promise<string> {
  return uploadAssets(config, sessionJwt, files);
}

/**
 * Helper: Upload all assets and return completion JWT.
 */
export async function uploadAllWorkerAssets(
  client: WfpClient,
  config: WFPConfig,
  workerName: string,
  files: Array<{ path: string; content: ArrayBuffer; contentType?: string }>
): Promise<string> {
  return uploadAllAssets(client, config, workerName, files);
}

/**
 * Delete a worker from the dispatch namespace.
 */
export async function deleteWorker(ctx: WfpContext, workerName: string): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.scriptPath(workerName),
    { method: 'DELETE' }
  );
}

/**
 * Get worker details.
 */
export async function getWorker(ctx: WfpContext, workerName: string): Promise<unknown> {
  const response = await ctx.cfFetch(ctx.scriptPath(workerName));
  return response.result;
}

/**
 * Check if worker exists.
 * @returns true if worker exists, false if 404, throws on other errors
 */
export async function workerExists(ctx: WfpContext, workerName: string): Promise<boolean> {
  try {
    await ctx.cfFetch(ctx.scriptPath(workerName));
    return true;
  } catch (error) {
    const cfError = error as import('./client').CloudflareAPIError;
    if (cfError.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * List all workers in the dispatch namespace.
 */
export async function listWorkers(ctx: WfpContext): Promise<Array<{
  id: string;
  script: string;
  created_on: string;
  modified_on: string;
}>> {
  const response = await ctx.cfFetch<Array<{
    id: string;
    script: string;
    created_on: string;
    modified_on: string;
  }>>(
    ctx.accountPath(`/workers/dispatch/namespaces/${ctx.config.dispatchNamespace}/scripts`)
  );
  return response.result || [];
}

/**
 * Update worker settings (bindings, environment variables, limits).
 * This updates the worker metadata without changing the script.
 */
export async function updateWorkerSettings(ctx: WfpContext, options: {
  workerName: string;
  bindings?: Array<WorkerBinding | CloudflareBindingRecord | Record<string, unknown>>;
  compatibility_date?: string;
  compatibility_flags?: string[];
  limits?: {
    cpu_ms?: number;
    subrequests?: number;
  };
}): Promise<void> {
  const { workerName, bindings, compatibility_date, compatibility_flags, limits } = options;

  const settings: Record<string, unknown> = {};

  if (bindings !== undefined) {
    settings.bindings = bindings.map((b) => ctx.formatBindingForUpdate(b));
  }

  if (compatibility_date !== undefined) {
    settings.compatibility_date = compatibility_date;
  }

  if (compatibility_flags !== undefined) {
    settings.compatibility_flags = compatibility_flags;
  }

  if (limits !== undefined) {
    settings.limits = limits;
  }

  await ctx.cfFetchWithRetry(
    `${ctx.scriptPath(workerName)}/settings`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }
  );
}

/**
 * Get worker settings.
 */
export async function getWorkerSettings(ctx: WfpContext, workerName: string): Promise<{
  bindings: CloudflareBindingRecord[];
  compatibility_date?: string;
  compatibility_flags?: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
}> {
  const response = await ctx.cfFetch<{
    bindings: CloudflareBindingRecord[];
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  }>(
    `${ctx.scriptPath(workerName)}/settings`
  );
  return response.result;
}

/**
 * Create or update a worker with WASM module support.
 * Used for deploying workers that require WASM modules (like yurucommu).
 */
export async function createWorkerWithWasm(
  ctx: WfpContext,
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
    /** JWT from assets upload completion (for static assets) */
    assetsJwt?: string;
  }
): Promise<void> {
  const { bindings, compatibility_date, compatibility_flags, limits, assetsJwt } = options;

  const formattedBindings = bindings.map(b => {
    switch (b.type) {
      case 'd1':
        return { type: 'd1', name: b.name, id: b.id };
      case 'r2_bucket':
        return { type: 'r2_bucket', name: b.name, bucket_name: b.bucket_name };
      case 'kv_namespace':
        return { type: 'kv_namespace', name: b.name, namespace_id: b.namespace_id };
      case 'queue':
        return {
          type: 'queue',
          name: b.name,
          queue_name: b.queue_name,
          ...(typeof b.delivery_delay === 'number' ? { delivery_delay: b.delivery_delay } : {}),
        };
      case 'analytics_engine':
        return { type: 'analytics_engine', name: b.name, dataset: b.dataset };
      case 'workflow':
        return {
          type: 'workflow',
          name: b.name,
          ...(b.workflow_name ? { workflow_name: b.workflow_name } : {}),
          ...(b.class_name ? { class_name: b.class_name } : {}),
          ...(typeof (b as { script_name?: string }).script_name === 'string'
            ? { script_name: (b as { script_name: string }).script_name }
            : {}),
        };
      case 'vectorize':
        return { type: 'vectorize', name: b.name, index_name: b.index_name };
      case 'plain_text':
        return { type: 'plain_text', name: b.name, text: b.text };
      default:
        return b;
    }
  });

  const metadata = buildWorkerMetadata({
    bindings: formattedBindings,
    compatibility_date,
    compatibility_flags,
    limits,
    assetsJwt,
  });

  const formData = new FormData();
  formData.append('worker.js', new Blob([workerScript], { type: 'application/javascript+module' }), 'worker.js');

  if (wasmContent) {
    formData.append('query_compiler_bg.wasm', new Blob([wasmContent], { type: 'application/wasm' }), 'query_compiler_bg.wasm');
  }

  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));

  await ctx.cfFetchWithRetry(
    ctx.scriptPath(workerName),
    {
      method: 'PUT',
      body: formData,
    }
  );
}
