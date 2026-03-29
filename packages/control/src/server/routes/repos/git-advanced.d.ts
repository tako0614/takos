import type { AuthenticatedRouteEnv } from '../route-auth';
declare const repoGitAdvanced: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/search": {
        $get: {
            input: {
                query: {
                    ref?: string | undefined;
                    path_prefix?: string | undefined;
                    limit?: string | undefined;
                    q?: string | undefined;
                    case_sensitive?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/semantic-search": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                query: string;
                matches: {
                    score: number;
                    content: string;
                    filePath: string;
                    chunkIndex: number;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/semantic-index": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
}, "/", "/repos/:repoId/semantic-index">;
export default repoGitAdvanced;
//# sourceMappingURL=git-advanced.d.ts.map