import type { R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env } from '../../../shared/types';
type ArtifactBucket = Pick<R2Bucket, 'get' | 'delete' | 'list'>;
export type WorkflowArtifactRecord = {
    id: string;
    runId: string;
    name: string;
    r2Key: string;
    sizeBytes: number | null;
    mimeType: string | null;
    expiresAt: string | null;
    createdAt: string;
};
export type ResolvedWorkflowArtifactFile = {
    runId: string;
    jobId: string;
    artifactName: string;
    artifactPath: string;
    r2Key: string;
    source: 'inventory' | 'prefix-fallback';
};
export declare function buildWorkflowArtifactPrefix(jobId: string, artifactName: string): string;
export declare function listWorkflowArtifactsForRun(env: Pick<Env, 'DB'>, repoId: string, runId: string): Promise<{
    createdAt: string;
    id: string;
    runId: string;
    name: string;
    r2Key: string;
    sizeBytes: number | null;
    mimeType: string | null;
    expiresAt: string | null;
}[] | null>;
export declare function getWorkflowArtifactById(env: Pick<Env, 'DB'>, repoId: string, artifactId: string): Promise<{
    id: string;
    runId: string;
    name: string;
    r2Key: string;
    sizeBytes: number | null;
    mimeType: string | null;
    expiresAt: string | null;
    createdAt: string;
    workflowRun: {
        repoId: string;
    };
} | null>;
export declare function deleteWorkflowArtifactById(env: Pick<Env, 'DB'>, bucket: ArtifactBucket | null | undefined, repoId: string, artifactId: string): Promise<{
    id: string;
    runId: string;
    name: string;
    r2Key: string;
    sizeBytes: number | null;
    mimeType: string | null;
    expiresAt: string | null;
    createdAt: string;
    workflowRun: {
        repoId: string;
    };
} | null>;
export declare function resolveWorkflowArtifactFileForJob(env: Pick<Env, 'DB' | 'GIT_OBJECTS' | 'TENANT_SOURCE'>, params: {
    repoId: string;
    runId: string;
    jobId: string;
    artifactName: string;
    artifactPath: string;
}): Promise<ResolvedWorkflowArtifactFile>;
export {};
//# sourceMappingURL=workflow-artifacts.d.ts.map