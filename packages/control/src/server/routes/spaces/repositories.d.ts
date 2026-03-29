import { type AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:spaceId/init-repo": {
        $post: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                message: string;
                skipped: true;
                repository: {
                    id: string;
                    space_id: string;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    forked_from_id: string | null;
                    stars: number;
                    forks: number;
                    git_enabled: boolean;
                    created_at: string;
                    updated_at: string;
                } | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                message: string;
                repository: {
                    id: string;
                    space_id: string;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    forked_from_id: string | null;
                    stars: number;
                    forks: number;
                    git_enabled: boolean;
                    created_at: string;
                    updated_at: string;
                } | null;
            };
            outputFormat: "json";
            status: 201;
        };
    };
}, "/", "/:spaceId/init-repo">;
export default _default;
//# sourceMappingURL=repositories.d.ts.map