/**
 * Workers for Platforms (WFP) Service
 *
 * Manages tenant worker deployment, resource binding, and lifecycle.
 * Uses Cloudflare API to interact with dispatch namespaces.
 */

import type { Env } from '../../../shared/types';
import type { WfpEnv } from './client';
import { CF_COMPATIBILITY_DATE } from '../../../shared/constants';
import {
  CF_API_BASE,
  WfpClient,
  createWfpConfig,
  resolveWfpConfig,
  type WFPConfig,
  type CFAPIResponse,
  type CloudflareAPIError,
} from './client';
import {
  createAssetsUploadSession,
  uploadAssets,
  uploadAllAssets,
  type AssetManifestEntry,
  type AssetUploadFile,
  type AssetsUploadSession,
  type AssetsUploadCompletion,
} from './assets';
import { logWarn } from '../../../shared/utils/logger';

export type { AssetManifestEntry, AssetUploadFile, AssetsUploadSession, AssetsUploadCompletion } from './assets';

export interface WorkerBinding {
  type: 'plain_text' | 'secret_text' | 'd1' | 'r2_bucket' | 'kv_namespace' | 'vectorize' | 'service';
  name: string;
  text?: string;
  database_id?: string;
  bucket_name?: string;
  namespace_id?: string;
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
  index_name?: string;
  service?: string;
  environment?: string;
}

/** Result shape returned by D1 query API */
interface D1QueryResult<T> {
  results: T[];
}

interface CreateWorkerOptions {
  workerName: string;
  workerScript: string;
  bindings: WorkerBinding[];
  compatibility_date?: string;
  compatibility_flags?: string[];
  limits?: {
    cpu_ms?: number;
    subrequests?: number;
  };
  /** JWT from assets upload completion (for static assets) */
  assetsJwt?: string;
}

/**
 * Sanitize a SQL table name to prevent injection.
 * Strips all characters except alphanumerics and underscores.
 */
function sanitizeTableName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Extract the results array from a D1 query response.
 * D1 returns Array<{ results: T[] }> -- this unwraps the first element.
 */
function extractD1Results<T>(raw: D1QueryResult<T>[]): T[] {
  return raw?.[0]?.results ?? [];
}

/**
 * Build worker metadata for Cloudflare dispatch namespace deployment.
 * Shared between createWorker and createWorkerWithWasm.
 */
function buildWorkerMetadata(options: {
  bindings: Array<Record<string, unknown>>;
  compatibility_date?: string;
  compatibility_flags?: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
  assetsJwt?: string;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    main_module: 'worker.js',
    bindings: options.bindings,
    compatibility_date: options.compatibility_date || CF_COMPATIBILITY_DATE,
  };

  if (options.compatibility_flags?.length) {
    metadata.compatibility_flags = options.compatibility_flags;
  }

  if (options.limits) {
    metadata.limits = options.limits;
  }

  if (options.assetsJwt) {
    metadata.assets = { jwt: options.assetsJwt };
  }

  return metadata;
}


export class WFPService {
  private config: WFPConfig;
  private client: WfpClient;

  // Timeout for Cloudflare API calls (10 minutes)
  private static readonly API_TIMEOUT_MS = 600000;

  constructor(env: WfpEnv | WFPConfig) {
    this.config = 'accountId' in env ? env : createWfpConfig(env);
    this.client = new WfpClient(this.config);
  }

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

  /**
   * Create or update a worker in the dispatch namespace
   */
  async createWorker(options: CreateWorkerOptions): Promise<void> {
    const { workerName, workerScript, bindings, compatibility_date, compatibility_flags, limits, assetsJwt } = options;

    const metadata = buildWorkerMetadata({
      bindings: bindings.map(b => this.formatBinding(b)),
      compatibility_date,
      compatibility_flags,
      limits,
      assetsJwt,
    });

    const formData = new FormData();
    formData.append('worker.js', new Blob([workerScript], { type: 'application/javascript+module' }), 'worker.js');
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));

    await this.cfFetchWithRetry(
      this.scriptPath(workerName),
      {
        method: 'PUT',
        body: formData,
      }
    );
  }

  /**
   * Create an assets upload session for a worker.
   * Returns a JWT token and list of files that need uploading.
   */
  async createAssetsUploadSession(
    workerName: string,
    manifest: Record<string, AssetManifestEntry>
  ): Promise<AssetsUploadSession> {
    return createAssetsUploadSession(this.client, this.config, workerName, manifest);
  }

  /**
   * Upload asset files using the session JWT.
   * Returns the completion JWT from the response.
   */
  async uploadAssets(
    sessionJwt: string,
    files: Record<string, AssetUploadFile>  // hash -> { base64Content, contentType }
  ): Promise<string> {
    return uploadAssets(this.config, sessionJwt, files);
  }

  /**
   * Helper: Upload all assets and return completion JWT
   * Combines createAssetsUploadSession and uploadAssets
   *
   * Per Cloudflare docs:
   * - If all assets are cached (buckets empty), session JWT IS the completion token
   * - If files were uploaded, upload response contains completion JWT
   */
  async uploadAllAssets(
    workerName: string,
    files: Array<{ path: string; content: ArrayBuffer; contentType?: string }>
  ): Promise<string> {
    return uploadAllAssets(this.client, this.config, workerName, files);
  }

  /**
   * Delete a worker from the dispatch namespace
   */
  async deleteWorker(workerName: string): Promise<void> {
    await this.cfFetchWithRetry(
      this.scriptPath(workerName),
      { method: 'DELETE' }
    );
  }

  /**
   * Get worker details
   */
  async getWorker(workerName: string): Promise<unknown> {
    const response = await this.cfFetch(this.scriptPath(workerName));
    return response.result;
  }

  /**
   * Check if worker exists
   * @returns true if worker exists, false if 404, throws on other errors
   */
  async workerExists(workerName: string): Promise<boolean> {
    try {
      await this.cfFetch(this.scriptPath(workerName));
      return true;
    } catch (error) {
      const cfError = error as CloudflareAPIError;
      if (cfError.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * List all workers in the dispatch namespace
   */
  async listWorkers(): Promise<Array<{
    id: string;
    script: string;
    created_on: string;
    modified_on: string;
  }>> {
    const response = await this.cfFetch<Array<{
      id: string;
      script: string;
      created_on: string;
      modified_on: string;
    }>>(
      this.accountPath(`/workers/dispatch/namespaces/${this.config.dispatchNamespace}/scripts`)
    );
    return response.result || [];
  }

  /**
   * Update worker settings (bindings, environment variables, limits)
   * This updates the worker metadata without changing the script
   */
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
    const { workerName, bindings, compatibility_date, compatibility_flags, limits } = options;

    const settings: Record<string, unknown> = {};

    if (bindings !== undefined) {
      settings.bindings = bindings.map((b) => this.formatBindingForUpdate(b));
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

    await this.cfFetchWithRetry(
      `${this.scriptPath(workerName)}/settings`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }
    );
  }

  /**
   * Get worker settings
   */
  async getWorkerSettings(workerName: string): Promise<{
    bindings: CloudflareBindingRecord[];
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  }> {
    const response = await this.cfFetch<{
      bindings: CloudflareBindingRecord[];
      compatibility_date?: string;
      compatibility_flags?: string[];
      limits?: { cpu_ms?: number; subrequests?: number };
    }>(
      `${this.scriptPath(workerName)}/settings`
    );
    return response.result;
  }

  /**
   * Create a D1 database for tenant
   */
  async createD1Database(name: string): Promise<string> {
    const response = await this.cfFetchWithRetry<{ uuid: string }>(
      this.accountPath('/d1/database'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }
    );
    if (!response.result?.uuid) {
      throw new Error(`Failed to create D1 database: no UUID returned from API`);
    }
    return response.result.uuid;
  }

  /**
   * Delete a D1 database
   */
  async deleteD1Database(databaseId: string): Promise<void> {
    await this.cfFetchWithRetry(
      this.accountPath(`/d1/database/${databaseId}`),
      { method: 'DELETE' }
    );
  }

  /**
   * Run SQL on a D1 database
   */
  async runD1SQL(databaseId: string, sql: string): Promise<unknown> {
    const response = await this.cfFetch(
      this.accountPath(`/d1/database/${databaseId}/query`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      }
    );
    return response.result;
  }

  /**
   * Type-safe D1 query for internal use.
   * Callers specify the expected row shape via generic parameter T.
   */
  private async runD1SQLTyped<T>(databaseId: string, sql: string): Promise<D1QueryResult<T>[]> {
    const response = await this.cfFetch<D1QueryResult<T>[]>(
      this.accountPath(`/d1/database/${databaseId}/query`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      }
    );
    return response.result;
  }

  /**
   * List tables in a D1 database
   */
  async listD1Tables(databaseId: string): Promise<Array<{ name: string }>> {
    const result = await this.runD1SQLTyped<{ name: string }>(
      databaseId,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    );
    return extractD1Results(result);
  }

  /**
   * Get table info (columns) for a D1 table
   */
  async getD1TableInfo(databaseId: string, tableName: string): Promise<Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>> {
    const safeName = sanitizeTableName(tableName);
    const result = await this.runD1SQLTyped<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>(databaseId, `PRAGMA table_info(${safeName})`);
    return extractD1Results(result);
  }

  /**
   * Get row count for a D1 table
   */
  async getD1TableCount(databaseId: string, tableName: string): Promise<number> {
    const safeName = sanitizeTableName(tableName);
    const result = await this.runD1SQLTyped<{ count: number }>(
      databaseId,
      `SELECT COUNT(*) as count FROM ${safeName}`
    );
    return extractD1Results(result)[0]?.count ?? 0;
  }

  /**
   * Create an R2 bucket for tenant
   */
  async createR2Bucket(name: string): Promise<void> {
    await this.cfFetchWithRetry(
      this.accountPath('/r2/buckets'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }
    );
  }

  /**
   * Delete an R2 bucket
   */
  async deleteR2Bucket(name: string): Promise<void> {
    await this.cfFetchWithRetry(
      this.accountPath(`/r2/buckets/${name}`),
      { method: 'DELETE' }
    );
  }

  /**
   * List objects in an R2 bucket
   */
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
    const params = new URLSearchParams();
    if (options?.prefix) params.set('prefix', options.prefix);
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('per_page', options.limit.toString());

    const response = await this.cfFetch<{
      objects: Array<{
        key: string;
        size: number;
        uploaded: string;
        etag: string;
      }>;
      truncated: boolean;
      cursor?: string;
    }>(
      this.accountPath(`/r2/buckets/${bucketName}/objects?${params.toString()}`)
    );
    return response.result || { objects: [], truncated: false };
  }

  /**
   * Upload a file to R2 bucket using S3-compatible API.
   * Uses raw fetch because the R2 object upload endpoint requires
   * Content-Type on the request (not JSON-wrapped).
   */
  async uploadToR2(
    bucketName: string,
    key: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer | string,
    options?: {
      contentType?: string;
    }
  ): Promise<void> {
    const response = await fetch(
      `${CF_API_BASE}${this.accountPath(`/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`)}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': options?.contentType || 'application/octet-stream',
        },
        body,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to upload to R2: ${response.status} ${text}`);
    }
  }

  /**
   * Delete an object from an R2 bucket
   */
  async deleteR2Object(bucketName: string, key: string): Promise<void> {
    await this.cfFetchWithRetry(
      this.accountPath(`/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`),
      { method: 'DELETE' }
    );
  }

  /**
   * Get R2 bucket usage stats
   */
  async getR2BucketStats(bucketName: string): Promise<{
    objectCount: number;
    payloadSize: number;
    metadataSize: number;
  }> {
    const listResult = await this.listR2Objects(bucketName, { limit: 1000 });
    const totalSize = listResult.objects.reduce((sum, obj) => sum + obj.size, 0);
    return {
      objectCount: listResult.objects.length,
      payloadSize: totalSize,
      metadataSize: 0,
    };
  }

  /**
   * Create a KV namespace
   */
  async createKVNamespace(title: string): Promise<string> {
    const response = await this.cfFetchWithRetry<{ id: string }>(
      this.accountPath('/storage/kv/namespaces'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }
    );
    if (!response.result?.id) {
      throw new Error(`Failed to create KV namespace: no ID returned from API`);
    }
    return response.result.id;
  }

  /**
   * Delete a KV namespace
   */
  async deleteKVNamespace(namespaceId: string): Promise<void> {
    await this.cfFetchWithRetry(
      this.accountPath(`/storage/kv/namespaces/${namespaceId}`),
      { method: 'DELETE' }
    );
  }

  /**
   * Create a Vectorize index
   */
  async createVectorizeIndex(
    name: string,
    config: { dimensions: number; metric: 'cosine' | 'euclidean' | 'dot-product' }
  ): Promise<string> {
    const response = await this.cfFetchWithRetry<{ name: string }>(
      this.accountPath('/vectorize/v2/indexes'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          config: {
            dimensions: config.dimensions,
            metric: config.metric,
          },
        }),
      }
    );
    if (!response.result?.name) {
      throw new Error(`Failed to create Vectorize index: no name returned from API`);
    }
    return response.result.name;
  }

  /**
   * Delete a Vectorize index
   */
  async deleteVectorizeIndex(name: string): Promise<void> {
    await this.cfFetchWithRetry(
      this.accountPath(`/vectorize/v2/indexes/${name}`),
      { method: 'DELETE' }
    );
  }

  /**
   * Create or update a worker with WASM module support
   * Used for deploying workers that require Prisma/WASM (like yurucommu)
   */
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

    await this.cfFetchWithRetry(
      this.scriptPath(workerName),
      {
        method: 'PUT',
        body: formData,
      }
    );
  }

  /**
   * Execute SQL query on a D1 database
   */
  async executeD1Query(databaseId: string, sql: string): Promise<unknown> {
    return this.runD1SQL(databaseId, sql);
  }

  async queryD1<T>(databaseId: string, sql: string): Promise<T[]> {
    const result = await this.runD1SQLTyped<T>(databaseId, sql);
    return extractD1Results(result);
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
      case 'vectorize':
        return { type: 'vectorize', name: binding.name, index_name: binding.index_name };
      case 'service':
        return { type: 'service', name: binding.name, service: binding.service, environment: binding.environment };
      default:
        throw new Error(`Unknown binding type: ${binding.type}`);
    }
  }

  private formatBindingForUpdate(binding: WorkerBinding | CloudflareBindingRecord | Record<string, unknown>): Record<string, unknown> {
    if (!binding || typeof binding !== 'object') {
      throw new Error('Invalid worker binding for update: expected object');
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

  /**
   * Deploy a worker with bindings from a bundle URL or pre-built script.
   */
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
      }>;
      bundleUrl?: string;
      bundleScript?: string;
      compatibilityDate?: string;
      compatibilityFlags?: string[];
      /** JWT from assets upload (for static assets) */
      assetsJwt?: string;
    }
  ): Promise<void> {
    let workerScript: string;

    if (options.bundleScript) {
      workerScript = options.bundleScript;
    } else if (options.bundleUrl) {
      const response = await fetch(options.bundleUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch bundle from ${options.bundleUrl}: ${response.status}`);
      }
      workerScript = await response.text();
    } else {
      throw new Error('Either bundleUrl or bundleScript is required');
    }

    const wfpBindings: WorkerBinding[] = options.bindings.map(b => {
      switch (b.type) {
        case 'd1':
          return { type: 'd1', name: b.name, database_id: b.id };
        case 'r2':
        case 'r2_bucket':
          return { type: 'r2_bucket', name: b.name, bucket_name: b.bucket_name };
        case 'kv':
        case 'kv_namespace':
          return { type: 'kv_namespace', name: b.name, namespace_id: b.namespace_id };
        case 'vectorize':
          return { type: 'vectorize', name: b.name, index_name: b.index_name || b.id };
        case 'plain_text':
          return { type: 'plain_text', name: b.name, text: b.text || '' };
        case 'secret_text':
          return { type: 'secret_text', name: b.name, text: b.text || '' };
        default:
          return { type: 'plain_text', name: b.name, text: b.text || '' };
      }
    });

    await this.createWorker({
      workerName,
      workerScript,
      bindings: wfpBindings,
      compatibility_date: options.compatibilityDate,
      compatibility_flags: options.compatibilityFlags,
      assetsJwt: options.assetsJwt,
    });
  }
}

export function createWfpService(env: WfpEnv): WFPService | null {
  const config = resolveWfpConfig(env);
  return config ? new WFPService(config) : null;
}

/**
 * Get the takos worker script bundle
 *
 * Priority:
 * 1. R2 bucket (required)
 *
 * Embedded fallback is intentionally disabled to avoid silently deploying
 * stale worker bundles that drift from yurucommu source.
 */
export async function getTakosWorkerScript(env: Pick<Env, 'WORKER_BUNDLES'>): Promise<string> {
  if (!env.WORKER_BUNDLES) {
    throw new Error(
      'WORKER_BUNDLES is not configured. ' +
      'Provisioning requires an explicit worker bundle in R2.'
    );
  }

  const object = await env.WORKER_BUNDLES.get('worker.js');
  if (!object) {
    throw new Error('worker.js is missing in WORKER_BUNDLES');
  }
  try {
    return await object.text();
  } catch (e) {
    throw new Error(
      `Failed to read worker bundle: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * Get the D1 migration SQL for takos tenant database
 */
export function getTakosMigrationSQL(): string {
  return `
-- Migration: 0001_initial
-- Description: Initial schema for takos tenant

-- Local user (single user per tenant)
CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  header_url TEXT,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES local_users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Used JTIs (for replay protection)
CREATE TABLE IF NOT EXISTS used_jtis (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_used_jtis_expires_at ON used_jtis(expires_at);

-- Posts
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES local_users(id),
  content TEXT NOT NULL,
  content_warning TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'unlisted', 'followers', 'direct')),
  in_reply_to_id TEXT,
  in_reply_to_actor TEXT,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);

-- Remote actors (cached)
CREATE TABLE IF NOT EXISTS remote_actors (
  id TEXT PRIMARY KEY,
  actor_url TEXT UNIQUE NOT NULL,
  inbox TEXT NOT NULL,
  shared_inbox TEXT,
  public_key TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_remote_actors_actor_url ON remote_actors(actor_url);

-- Follows (both local->remote and remote->local)
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_actor TEXT NOT NULL,
  following_actor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(follower_actor, following_actor)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_actor);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_actor);
CREATE INDEX IF NOT EXISTS idx_follows_status ON follows(status);

-- Inbox queue (for async processing)
CREATE TABLE IF NOT EXISTS inbox_queue (
  id TEXT PRIMARY KEY,
  activity_type TEXT NOT NULL,
  actor_url TEXT NOT NULL,
  activity_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  processed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_queue_processed ON inbox_queue(processed_at);
CREATE INDEX IF NOT EXISTS idx_inbox_queue_received ON inbox_queue(received_at);

-- Outbox queue (for delivery)
CREATE TABLE IF NOT EXISTS outbox_queue (
  id TEXT PRIMARY KEY,
  activity_json TEXT NOT NULL,
  target_inbox TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_queue_next_attempt ON outbox_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_queue_completed ON outbox_queue(completed_at);

-- Likes
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  actor_url TEXT NOT NULL,
  object_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(actor_url, object_url)
);

CREATE INDEX IF NOT EXISTS idx_likes_object ON likes(object_url);

-- Announces (boosts/reblogs)
CREATE TABLE IF NOT EXISTS announces (
  id TEXT PRIMARY KEY,
  actor_url TEXT NOT NULL,
  object_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(actor_url, object_url)
);

CREATE INDEX IF NOT EXISTS idx_announces_object ON announces(object_url);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('follow', 'like', 'announce', 'mention', 'reply')),
  actor_url TEXT NOT NULL,
  object_url TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- Migration: 0002_add_signature_columns
-- Description: Add HTTP Signature verification columns to inbox_queue

ALTER TABLE inbox_queue ADD COLUMN signature_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbox_queue ADD COLUMN signature_error TEXT;

CREATE INDEX IF NOT EXISTS idx_inbox_queue_signature ON inbox_queue(signature_verified);

-- Migration: 0003_add_tenant_config
-- Description: Add tenant_config table for tenant configuration storage

CREATE TABLE IF NOT EXISTS tenant_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Migration: 0004_add_media_files
-- Description: Add media_files table for fast media lookup

CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_media_files_key ON media_files(r2_key);
`;
}
