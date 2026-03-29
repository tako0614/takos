import type { AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/fork": {
        $post: {
            input: {
                json: {
                    name?: string | undefined;
                    target_space_id?: string | undefined;
                    copy_workflows?: boolean | undefined;
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
}, "/", "/repos/:repoId/fork">;
export default _default;
//# sourceMappingURL=forks.d.ts.map