import type { AuthenticatedRouteEnv } from '../../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/actions/runs/:runId/artifacts": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                artifacts: {
                    id: string;
                    name: string;
                    size_bytes: number | null;
                    mime_type: string | null;
                    expires_at: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/artifacts/:artifactId": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    artifactId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/artifacts/:artifactId": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                } & {
                    artifactId: string;
                };
            };
            output: null;
            outputFormat: "body";
            status: 204;
        } | {
            input: {
                param: {
                    repoId: string;
                } & {
                    artifactId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: 200 | 201;
        };
    };
}, "/", "/repos/:repoId/actions/artifacts/:artifactId">;
export default _default;
//# sourceMappingURL=artifacts.d.ts.map