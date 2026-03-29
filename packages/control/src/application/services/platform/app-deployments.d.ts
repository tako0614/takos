import type { Env } from '../../../shared/types';
type RepoRefType = 'branch' | 'tag' | 'commit';
type CreateAppDeploymentInput = {
    repoId: string;
    ref?: string;
    refType?: RepoRefType;
    approveOauthAutoEnv?: boolean;
    approveSourceChange?: boolean;
};
export declare function encodeSourceRef(refType: RepoRefType | undefined, ref: string | undefined, commitSha?: string): string | undefined;
export declare function decodeSourceRef(encoded: string | null | undefined): {
    ref: string | null;
    ref_type: RepoRefType | null;
    commit_sha: string | null;
};
export declare class AppDeploymentService {
    private env;
    constructor(env: Env);
    private resolveRepoTarget;
    private resolveBuildArtifacts;
    deployFromRepoRef(_spaceId: string, _userId: string, _input: CreateAppDeploymentInput): Promise<never>;
    list(_spaceId: string): Promise<never>;
    get(_spaceId: string, _appDeploymentId: string): Promise<{
        hostnames?: string[];
    }>;
    remove(_spaceId: string, _appDeploymentId: string): Promise<never>;
    rollback(_spaceId: string, _userId: string, _appDeploymentId: string, _options?: {
        approveOauthAutoEnv?: boolean;
    }): Promise<never>;
}
export {};
//# sourceMappingURL=app-deployments.d.ts.map