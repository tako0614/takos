import { type AuthenticatedRouteEnv } from '../route-auth';
declare const resourcesTokens: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/tokens": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                tokens: {
                    id: string;
                    name: string;
                    token_prefix: string;
                    permission: string;
                    expires_at: string | null;
                    last_used_at: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/by-name/:name/tokens": {
        $get: {
            input: {
                param: {
                    name: string;
                };
            };
            output: {
                tokens: {
                    id: string;
                    name: string;
                    token_prefix: string;
                    permission: string;
                    expires_at: string | null;
                    last_used_at: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/tokens": {
        $post: {
            input: {
                json: {
                    name: string;
                    permission?: "read" | "write" | undefined;
                    expires_in_days?: number | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                token: {
                    id: string;
                    name: string;
                    token: string;
                    token_prefix: string;
                    permission: "read" | "write";
                    expires_at: string | null;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/by-name/:name/tokens": {
        $post: {
            input: {
                json: {
                    name: string;
                    permission?: "read" | "write" | undefined;
                    expires_in_days?: number | undefined;
                };
            } & {
                param: {
                    name: string;
                };
            };
            output: {
                token: {
                    id: string;
                    name: string;
                    token: string;
                    token_prefix: string;
                    permission: "read" | "write";
                    expires_at: string | null;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:id/tokens/:tokenId": {
        $delete: {
            input: {
                param: {
                    id: string;
                } & {
                    tokenId: string;
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
    "/by-name/:name/tokens/:tokenId": {
        $delete: {
            input: {
                param: {
                    name: string;
                } & {
                    tokenId: string;
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
    "/:id/connection": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                type: import("../../../shared/types").ResourceType;
                name: string;
                status: import("../../../shared/types").ResourceStatus;
                connection: {
                    [x: string]: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/by-name/:name/connection": {
        $get: {
            input: {
                param: {
                    name: string;
                };
            };
            output: {
                type: import("../../../shared/types").ResourceType;
                name: string;
                status: import("../../../shared/types").ResourceStatus;
                connection: {
                    [x: string]: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/by-name/:name/connection">;
export default resourcesTokens;
//# sourceMappingURL=tokens.d.ts.map