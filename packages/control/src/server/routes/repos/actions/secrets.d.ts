import type { AuthenticatedRouteEnv } from '../../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/actions/secrets": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                secrets: {
                    name: string;
                    created_at: string;
                    updated_at: string | null;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/secrets/:name": {
        $put: {
            input: {
                param: {
                    name: string;
                } & {
                    repoId: string;
                };
            };
            output: {
                name: string;
                created_at: string;
                updated_at: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/secrets/:name": {
        $delete: {
            input: {
                param: {
                    name: string;
                } & {
                    repoId: string;
                };
            };
            output: null;
            outputFormat: "body";
            status: 204;
        } | {
            input: {
                param: {
                    name: string;
                } & {
                    repoId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: 200 | 201;
        };
    };
}, "/", "/repos/:repoId/actions/secrets/:name">;
export default _default;
//# sourceMappingURL=secrets.d.ts.map