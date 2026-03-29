import type { AuthenticatedRouteEnv } from '../route-auth';
declare const workersBase: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/": {
        $get: {
            input: {};
            output: {
                services: {
                    workspace_name: string;
                    id: string;
                    space_id: string;
                    service_type: "app" | "service";
                    status: "pending" | "building" | "deployed" | "failed" | "stopped";
                    config: string | null;
                    hostname: string | null;
                    service_name: string | null;
                    slug: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/space/:spaceId": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                services: {
                    id: string;
                    space_id: string;
                    service_type: "app" | "service";
                    status: "pending" | "building" | "deployed" | "failed" | "stopped";
                    config: string | null;
                    hostname: string | null;
                    service_name: string | null;
                    slug: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/": {
        $post: {
            input: {
                json: {
                    config?: string | undefined;
                    space_id?: string | undefined;
                    slug?: string | undefined;
                    service_type?: "service" | "app" | undefined;
                };
            };
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 429;
        } | {
            input: {
                json: {
                    config?: string | undefined;
                    space_id?: string | undefined;
                    slug?: string | undefined;
                    service_type?: "service" | "app" | undefined;
                };
            };
            output: {
                service: {
                    id: string;
                    space_id: string;
                    service_type: "app" | "service";
                    status: "pending" | "building" | "deployed" | "failed" | "stopped";
                    config: string | null;
                    hostname: string | null;
                    service_name: string | null;
                    slug: string | null;
                    created_at: string;
                    updated_at: string;
                } | null;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:id": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                service: {
                    workspace_name: string;
                    id: string;
                    space_id: string;
                    service_type: "app" | "service";
                    status: "pending" | "building" | "deployed" | "failed" | "stopped";
                    config: string | null;
                    hostname: string | null;
                    service_name: string | null;
                    slug: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/logs": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                invocations: {
                    datetime: string;
                    status: string;
                    cpuTime: number;
                    responseStatus: number;
                    clientRequestMethod: string;
                    clientRequestPath: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id": {
        $delete: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:id">;
export default workersBase;
//# sourceMappingURL=routes.d.ts.map