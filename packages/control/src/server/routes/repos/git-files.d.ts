import type { AuthenticatedRouteEnv } from '../route-auth';
declare const gitFiles: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/tree/:ref/*": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    ref: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/tree/:ref": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    ref: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/blob/:ref/*": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    ref: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/blob/:ref": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    ref: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/diff/:baseHead": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    baseHead: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
}, "/", "/repos/:repoId/diff/:baseHead">;
export default gitFiles;
//# sourceMappingURL=git-files.d.ts.map