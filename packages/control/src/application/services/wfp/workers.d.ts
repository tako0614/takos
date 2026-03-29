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
import type { AssetManifestEntry, AssetUploadFile, AssetsUploadSession } from './assets';
import type { WfpContext, WorkerBinding, CloudflareBindingRecord, CreateWorkerOptions } from './wfp-contracts';
/**
 * Create or update a worker in the dispatch namespace.
 */
export declare function createWorker(ctx: WfpContext, options: CreateWorkerOptions): Promise<void>;
/**
 * Create an assets upload session for a worker.
 */
export declare function createWorkerAssetsUploadSession(client: WfpClient, config: WFPConfig, workerName: string, manifest: Record<string, AssetManifestEntry>): Promise<AssetsUploadSession>;
/**
 * Upload asset files using the session JWT.
 */
export declare function uploadWorkerAssets(config: WFPConfig, sessionJwt: string, files: Record<string, AssetUploadFile>): Promise<string>;
/**
 * Helper: Upload all assets and return completion JWT.
 */
export declare function uploadAllWorkerAssets(client: WfpClient, config: WFPConfig, workerName: string, files: Array<{
    path: string;
    content: ArrayBuffer;
    contentType?: string;
}>): Promise<string>;
/**
 * Delete a worker from the dispatch namespace.
 */
export declare function deleteWorker(ctx: WfpContext, workerName: string): Promise<void>;
/**
 * Get worker details.
 */
export declare function getWorker(ctx: WfpContext, workerName: string): Promise<unknown>;
/**
 * Check if worker exists.
 * @returns true if worker exists, false if 404, throws on other errors
 */
export declare function workerExists(ctx: WfpContext, workerName: string): Promise<boolean>;
/**
 * List all workers in the dispatch namespace.
 */
export declare function listWorkers(ctx: WfpContext): Promise<Array<{
    id: string;
    script: string;
    created_on: string;
    modified_on: string;
}>>;
/**
 * Update worker settings (bindings, environment variables, limits).
 * This updates the worker metadata without changing the script.
 */
export declare function updateWorkerSettings(ctx: WfpContext, options: {
    workerName: string;
    bindings?: Array<WorkerBinding | CloudflareBindingRecord | Record<string, unknown>>;
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: {
        cpu_ms?: number;
        subrequests?: number;
    };
}): Promise<void>;
/**
 * Get worker settings.
 */
export declare function getWorkerSettings(ctx: WfpContext, workerName: string): Promise<{
    bindings: CloudflareBindingRecord[];
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: {
        cpu_ms?: number;
        subrequests?: number;
    };
}>;
/**
 * Create or update a worker with WASM module support.
 * Used for deploying workers that require WASM modules (like yurucommu).
 */
export declare function createWorkerWithWasm(ctx: WfpContext, workerName: string, workerScript: string, wasmContent: ArrayBuffer | null, options: {
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
}): Promise<void>;
//# sourceMappingURL=workers.d.ts.map