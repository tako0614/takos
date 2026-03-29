/**
 * Workflow Engine – storage operations (logs and artifacts)
 */
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { WorkflowBucket } from './workflow-engine-types';
export declare function storeJobLogs(db: D1Database, bucket: WorkflowBucket, jobId: string, logs: string): Promise<string>;
export declare function createArtifact(db: D1Database, bucket: WorkflowBucket, options: {
    runId: string;
    name: string;
    data: ArrayBuffer | Uint8Array | string;
    mimeType?: string;
    expiresInDays?: number;
}): Promise<{
    id: string;
    r2Key: string;
}>;
//# sourceMappingURL=workflow-storage.d.ts.map