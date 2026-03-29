import type { AuthenticatedRouteEnv } from '../route-auth';
declare const resourcesR2: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/r2/objects": {
        $get: {
            input: {
                query: {
                    limit?: string | undefined;
                    prefix?: string | undefined;
                    cursor?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                objects: {
                    key: string;
                    size: number;
                    uploaded: string;
                    etag: string;
                }[];
                truncated: boolean;
                cursor: string | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/r2/stats": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                stats: {
                    objectCount: number;
                    payloadSize: number;
                    metadataSize: number;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/r2/objects/:key": {
        $delete: {
            input: {
                param: {
                    id: string;
                } & {
                    key: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:id/r2/objects/:key">;
export default resourcesR2;
//# sourceMappingURL=r2.d.ts.map