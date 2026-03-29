import type { Env } from '../../shared/types';
import { type BaseVariables } from './route-auth';
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: BaseVariables;
}, {
    "/status": {
        $get: {
            input: {};
            output: any;
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/complete": {
        $post: {
            input: {
                json: {
                    username: string;
                };
            };
            output: {
                success: true;
                username: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/check-username": {
        $post: {
            input: {
                json: {
                    username: string;
                };
            };
            output: {
                available: false;
                error: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                json: {
                    username: string;
                };
            };
            output: {
                available: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/check-username">;
export default _default;
//# sourceMappingURL=setup.d.ts.map