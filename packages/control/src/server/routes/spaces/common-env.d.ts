import { type SpaceAccessRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<SpaceAccessRouteEnv, {
    "/:spaceId/common-env": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                env: {
                    name: string;
                    secret: boolean;
                    value: string;
                    updatedAt: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/common-env": {
        $put: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/common-env/:name": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    name: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:spaceId/common-env/:name">;
export default _default;
//# sourceMappingURL=common-env.d.ts.map