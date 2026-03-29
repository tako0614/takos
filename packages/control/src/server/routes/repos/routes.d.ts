import type { AuthenticatedRouteEnv } from '../route-auth';
export { type RepoBucketBinding, type GitBucket, toGitBucket, sanitizeRepoName, readableCommitErrorResponse, generateExploreInvalidationUrls, encodeBase64, hasWriteRole, type TreeFlattenLimitErrorCode, getTreeFlattenLimitError, } from './shared';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/spaces/:spaceId/repos": {
        $post: {
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    visibility?: "private" | "public" | "internal" | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                repository: {
                    owner_username: string;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    git_enabled: number | boolean;
                    created_at: string | null;
                    updated_at: string | null;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/spaces/:spaceId/repos": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                repositories: {
                    id: string;
                    owner_username: string;
                    owner: {
                        username: string;
                    } | undefined;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    git_enabled: boolean;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                repository: {
                    owner_username: string;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    git_enabled: number | boolean;
                    created_at: string | null;
                    updated_at: string | null;
                };
                branch_count: number;
                starred: boolean;
                user_role: import("../../../shared/types").SpaceRole | null;
                workspace: {
                    name: string;
                } | null;
                owner: {
                    name: string;
                    picture: string | null;
                } | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId": {
        $patch: {
            input: {
                json: {
                    name?: string | undefined;
                    description?: string | undefined;
                    visibility?: "private" | "public" | "internal" | undefined;
                    default_branch?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                repository: {
                    owner_username: string;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    git_enabled: number | boolean;
                    created_at: string | null;
                    updated_at: string | null;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId">;
export default _default;
//# sourceMappingURL=routes.d.ts.map