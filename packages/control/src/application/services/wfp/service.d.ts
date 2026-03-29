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
import { type WFPConfig } from './client';
export type { WorkerBinding, CloudflareBindingRecord, CreateWorkerOptions, } from './wfp-contracts';
export type { AssetManifestEntry, AssetUploadFile, AssetsUploadSession, AssetsUploadCompletion, } from './assets';
export { getTakosWorkerScript, getTakosMigrationSQL } from './orchestrator';
export { formatBinding, formatBindingForUpdate } from './bindings';
import * as workerOps from './workers';
import * as r2Ops from './r2';
import * as queueOps from './queues';
import * as vectorizeOps from './vectorize';
import * as orchestratorOps from './orchestrator';
/**
 * WFP service facade.
 *
 * Thin wrapper that constructs a {@link WfpContext} and exposes context-bound
 * submodule namespaces. All domain logic lives in the per-resource modules.
 */
export declare class WFPService {
    readonly workers: {
        readonly createWorker: (options: Parameters<typeof workerOps.createWorker>[1]) => Promise<void>;
        readonly createWorkerAssetsUploadSession: (workerName: Parameters<typeof workerOps.createWorkerAssetsUploadSession>[2], manifest: Parameters<typeof workerOps.createWorkerAssetsUploadSession>[3]) => Promise<import("./assets").AssetsUploadSession>;
        readonly uploadWorkerAssets: (sessionJwt: Parameters<typeof workerOps.uploadWorkerAssets>[1], files: Parameters<typeof workerOps.uploadWorkerAssets>[2]) => Promise<string>;
        readonly uploadAllWorkerAssets: (workerName: Parameters<typeof workerOps.uploadAllWorkerAssets>[2], files: Parameters<typeof workerOps.uploadAllWorkerAssets>[3]) => Promise<string>;
        readonly deleteWorker: (workerName: string) => Promise<void>;
        readonly getWorker: (workerName: string) => Promise<unknown>;
        readonly workerExists: (workerName: string) => Promise<boolean>;
        readonly listWorkers: () => Promise<{
            id: string;
            script: string;
            created_on: string;
            modified_on: string;
        }[]>;
        readonly updateWorkerSettings: (options: Parameters<typeof workerOps.updateWorkerSettings>[1]) => Promise<void>;
        readonly getWorkerSettings: (workerName: string) => Promise<{
            bindings: import("./wfp-contracts").CloudflareBindingRecord[];
            compatibility_date?: string;
            compatibility_flags?: string[];
            limits?: {
                cpu_ms?: number;
                subrequests?: number;
            };
        }>;
        readonly createWorkerWithWasm: (workerName: Parameters<typeof workerOps.createWorkerWithWasm>[1], workerScript: Parameters<typeof workerOps.createWorkerWithWasm>[2], wasmContent: Parameters<typeof workerOps.createWorkerWithWasm>[3], options: Parameters<typeof workerOps.createWorkerWithWasm>[4]) => Promise<void>;
    };
    readonly d1: {
        readonly createD1Database: (name: string) => Promise<string>;
        readonly deleteD1Database: (databaseId: string) => Promise<void>;
        readonly runD1SQL: (databaseId: string, sql: string) => Promise<unknown>;
        readonly listD1Tables: (databaseId: string) => Promise<{
            name: string;
        }[]>;
        readonly getD1TableInfo: (databaseId: string, tableName: string) => Promise<{
            cid: number;
            name: string;
            type: string;
            notnull: number;
            dflt_value: string | null;
            pk: number;
        }[]>;
        readonly getD1TableCount: (databaseId: string, tableName: string) => Promise<number>;
        readonly executeD1Query: (databaseId: string, sql: string) => Promise<unknown>;
        readonly queryD1: <T>(databaseId: string, sql: string) => Promise<T[]>;
    };
    readonly r2: {
        readonly createR2Bucket: (name: string) => Promise<void>;
        readonly deleteR2Bucket: (name: string) => Promise<void>;
        readonly listR2Objects: (bucketName: string, options?: Parameters<typeof r2Ops.listR2Objects>[2]) => Promise<{
            objects: Array<{
                key: string;
                size: number;
                uploaded: string;
                etag: string;
            }>;
            truncated: boolean;
            cursor?: string;
        }>;
        readonly uploadToR2: (bucketName: string, key: string, body: Parameters<typeof r2Ops.uploadToR2>[3], options?: Parameters<typeof r2Ops.uploadToR2>[4]) => Promise<void>;
        readonly deleteR2Object: (bucketName: string, key: string) => Promise<void>;
        readonly getR2BucketStats: (bucketName: string) => Promise<{
            objectCount: number;
            payloadSize: number;
            metadataSize: number;
        }>;
    };
    readonly kv: {
        readonly createKVNamespace: (title: string) => Promise<string>;
        readonly deleteKVNamespace: (namespaceId: string) => Promise<void>;
    };
    readonly queues: {
        readonly createQueue: (queueName: string, options?: Parameters<typeof queueOps.createQueue>[2]) => Promise<{
            id: string;
            name: string;
        }>;
        readonly listQueues: () => Promise<{
            id: string;
            name: string;
        }[]>;
        readonly deleteQueue: (queueId: string) => Promise<void>;
        readonly deleteQueueByName: (queueName: string) => Promise<void>;
    };
    readonly vectorize: {
        readonly createVectorizeIndex: (name: string, vecConfig: Parameters<typeof vectorizeOps.createVectorizeIndex>[2]) => Promise<string>;
        readonly deleteVectorizeIndex: (name: string) => Promise<void>;
    };
    private readonly ctx;
    constructor(env: WfpEnv | WFPConfig);
    deployWorkerWithBindings(workerName: string, options: Parameters<typeof orchestratorOps.deployWorkerWithBindings>[3]): Promise<void>;
}
export declare function createWfpService(env: WfpEnv): WFPService | null;
//# sourceMappingURL=service.d.ts.map