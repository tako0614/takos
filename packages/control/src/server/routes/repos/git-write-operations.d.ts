import type { ExecutionContext } from '../../../shared/types/bindings.ts';
import type { AuthenticatedRouteEnv } from '../route-auth';
import { type RepoBucketBinding } from './routes';
export interface FileEntry {
    path: string;
    content: string;
}
interface BaseWriteOptions {
    db: AuthenticatedRouteEnv['Bindings']['DB'];
    bucket: RepoBucketBinding;
    repoId: string;
    files: FileEntry[];
    user: {
        id: string;
        name: string;
        email: string;
    };
    executionCtx: ExecutionContext;
    workflowQueue: AuthenticatedRouteEnv['Bindings']['WORKFLOW_QUEUE'];
    encryptionKey: string | undefined;
}
interface CommitFilesOptions extends BaseWriteOptions {
    message: string;
}
interface ImportFilesOptions extends BaseWriteOptions {
    message: string;
    appendMode: boolean;
}
export declare function importFilesToDefaultBranch(options: ImportFilesOptions): Promise<{
    commitSha: string;
    fileCount: number;
}>;
export declare function commitFilesToDefaultBranch(options: CommitFilesOptions): Promise<{
    commitSha: string;
}>;
export {};
//# sourceMappingURL=git-write-operations.d.ts.map