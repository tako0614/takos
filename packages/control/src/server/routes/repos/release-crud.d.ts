import type { AuthenticatedRouteEnv } from '../route-auth';
declare const releaseCrud: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/releases": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                releases: {
                    id: string;
                    repo_id: string;
                    tag: string;
                    name: string | null;
                    description: string | null;
                    commit_sha: string | null;
                    is_prerelease: boolean;
                    is_draft: boolean;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
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
                    author_id: string | null;
                    published_at: string | null;
                    created_at: string;
                    updated_at: string;
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    } | null;
                }[];
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/releases/:tag": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                };
            };
            output: {
                release: {
                    id: string;
                    repo_id: string;
                    tag: string;
                    name: string | null;
                    description: string | null;
                    commit_sha: string | null;
                    is_prerelease: boolean;
                    is_draft: boolean;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
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
                    author_id: string | null;
                    published_at: string | null;
                    created_at: string;
                    updated_at: string;
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    } | null;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/releases": {
        $post: {
            input: {
                json: {
                    tag: string;
                    name?: string | null | undefined;
                    description?: string | null | undefined;
                    commit_sha?: string | undefined;
                    is_prerelease?: boolean | undefined;
                    is_draft?: boolean | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                release: {
                    id: string | undefined;
                    repo_id: string | undefined;
                    tag: string | undefined;
                    name: string | null | undefined;
                    description: string | null | undefined;
                    commit_sha: string | null | undefined;
                    is_prerelease: boolean;
                    is_draft: boolean;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
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
                    author_id: string | null | undefined;
                    published_at: string | null | undefined;
                    created_at: string | undefined;
                    updated_at: string | undefined;
                    author: any;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/releases/:tag": {
        $patch: {
            input: {
                json: {
                    name?: string | null | undefined;
                    description?: string | null | undefined;
                    is_prerelease?: boolean | undefined;
                    is_draft?: boolean | undefined;
                };
            } & {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                };
            };
            output: {
                release: {
                    id: string | undefined;
                    repo_id: string | undefined;
                    tag: string | undefined;
                    name: string | null | undefined;
                    description: string | null | undefined;
                    commit_sha: string | null | undefined;
                    is_prerelease: boolean;
                    is_draft: boolean;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
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
                    author_id: string | null | undefined;
                    published_at: string | null | undefined;
                    created_at: string | undefined;
                    updated_at: string | undefined;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/releases/:tag": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
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
    "/repos/:repoId/releases/latest": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                release: {
                    id: string;
                    repo_id: string;
                    tag: string;
                    name: string | null;
                    description: string | null;
                    commit_sha: string | null;
                    is_prerelease: false;
                    is_draft: false;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
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
                    author_id: string | null;
                    published_at: string | null;
                    created_at: string;
                    updated_at: string;
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    } | null;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/releases/latest">;
export default releaseCrud;
//# sourceMappingURL=release-crud.d.ts.map