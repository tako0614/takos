import type { OptionalAuthRouteEnv } from '../route-auth';
export declare const blockMuteRoutes: import("hono/hono-base").HonoBase<OptionalAuthRouteEnv, {
    "/:username/block": {
        $post: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                success: true;
                blocked: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/block": {
        $delete: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                success: true;
                blocked: false;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/mute": {
        $post: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                success: true;
                muted: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/mute": {
        $delete: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                success: true;
                muted: false;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:username/mute">;
//# sourceMappingURL=block-mute.d.ts.map