import { type AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:spaceId/stores": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                stores: {
                    slug: string;
                    name: string;
                    summary: string | null;
                    icon_url: string | null;
                    is_default: boolean;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/stores": {
        $post: {
            input: {
                json: {
                    name?: string | undefined;
                    slug?: string | undefined;
                    summary?: string | undefined;
                    icon_url?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                store: {
                    slug: string;
                    name: string;
                    summary: string | null;
                    icon_url: string | null;
                    is_default: boolean;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:spaceId/stores/:storeSlug": {
        $patch: {
            input: {
                json: {
                    name?: string | undefined;
                    slug?: string | undefined;
                    summary?: string | undefined;
                    icon_url?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                } & {
                    storeSlug: string;
                };
            };
            output: {
                store: {
                    slug: string;
                    name: string;
                    summary: string | null;
                    icon_url: string | null;
                    is_default: boolean;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/stores/:storeSlug": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    storeSlug: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:spaceId/stores/:storeSlug">;
export default _default;
//# sourceMappingURL=stores.d.ts.map