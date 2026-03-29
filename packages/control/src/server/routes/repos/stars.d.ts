import type { AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/star": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                starred: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/star": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                starred: false;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/starred": {
        $get: {
            input: {};
            output: {
                repos: any;
                has_more: boolean;
                total: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/star": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                starred: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/star">;
export default _default;
//# sourceMappingURL=stars.d.ts.map