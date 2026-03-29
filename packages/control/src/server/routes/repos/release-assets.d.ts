import type { AuthenticatedRouteEnv } from '../route-auth';
declare const releaseAssets: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/releases/:tag/assets": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                };
            };
            output: {
                asset: {
                    id: string;
                    name: string;
                    content_type: string;
                    size: number;
                    download_count: number;
                    bundle_format: string | undefined;
                    bundle_meta: {
                        name?: string | undefined;
                        app_id?: string | undefined;
                        version: string;
                        description?: string | undefined;
                        icon?: string | undefined;
                        category?: "app" | "service" | "library" | "template" | "social" | undefined;
                        tags?: string[] | undefined;
                        dependencies?: {
                            repo: string;
                            version: string;
                        }[] | undefined;
                    } | undefined;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/releases/:tag/assets/:assetId/download": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                } & {
                    assetId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/releases/:tag/assets/:assetId": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                } & {
                    assetId: string;
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
                    tag: string;
                } & {
                    assetId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: 200 | 201;
        };
    };
} & {
    "/repos/:repoId/releases/:tag/assets": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                };
            };
            output: {
                assets: {
                    id: string;
                    name: string;
                    content_type: string;
                    size: number;
                    download_count: number;
                    bundle_format: string | undefined;
                    bundle_meta: {
                        name?: string | undefined;
                        app_id?: string | undefined;
                        version: string;
                        description?: string | undefined;
                        icon?: string | undefined;
                        category?: "app" | "service" | "library" | "template" | "social" | undefined;
                        tags?: string[] | undefined;
                        dependencies?: {
                            repo: string;
                            version: string;
                        }[] | undefined;
                    } | undefined;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/releases/:tag/assets">;
export default releaseAssets;
//# sourceMappingURL=release-assets.d.ts.map