import { type AuthenticatedRouteEnv } from '../route-auth';
import { type ModelProvider } from '../../../application/services/agent';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/": {
        $get: {
            input: {};
            output: {
                spaces: {
                    id: string | undefined;
                    slug: string;
                    name: string;
                    description: string | null;
                    kind: string;
                    owner_principal_id: string | null;
                    automation_principal_id: string | null;
                    security_posture: "standard" | "restricted_egress";
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
                    name: string;
                    id?: string | undefined;
                    description?: string | undefined;
                };
            };
            output: {
                space: {
                    id: string | undefined;
                    slug: string;
                    name: string;
                    description: string | null;
                    kind: string;
                    owner_principal_id: string | null;
                    automation_principal_id: string | null;
                    security_posture: "standard" | "restricted_egress";
                    created_at: string;
                    updated_at: string;
                };
                repository: {
                    id: string;
                    space_id: string;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    forked_from_id: string | null;
                    stars: number;
                    forks: number;
                    git_enabled: boolean;
                    created_at: string;
                    updated_at: string;
                } | null;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/me": {
        $get: {
            input: {};
            output: any;
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: any;
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/export": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                space: {
                    id: string | undefined;
                    slug: string;
                    name: string;
                    description: string | null;
                    kind: string;
                    owner_principal_id: string | null;
                    automation_principal_id: string | null;
                    security_posture: "standard" | "restricted_egress";
                    created_at: string;
                    updated_at: string;
                };
                exported_at: string;
                repositories: {
                    id: string;
                    name: string;
                    updated_at: string;
                    export_url: string;
                    method: "GET";
                }[];
                threads: {
                    id: string;
                    title: string | null;
                    status: string;
                    updated_at: string;
                    export_url: string;
                    method: "GET";
                    formats: ["markdown", "json", "pdf"];
                }[];
                resources: {
                    d1: {
                        id: string;
                        name: string;
                        updated_at: string;
                        access_level: string;
                        export_url: string;
                        method: "POST";
                    }[];
                    r2: {
                        id: string;
                        name: string;
                        updated_at: string;
                        access_level: string;
                    }[];
                };
                counts: {
                    repositories: number;
                    threads: number;
                    d1_resources: number;
                    r2_resources: number;
                    total_resources: number;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId": {
        $patch: {
            input: {
                json: {
                    name?: string | undefined;
                    ai_model?: string | undefined;
                    ai_provider?: string | undefined;
                    security_posture?: "standard" | "restricted_egress" | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                space: {
                    id: string | undefined;
                    slug: string;
                    name: string;
                    description: string | null;
                    kind: string;
                    owner_principal_id: string | null;
                    automation_principal_id: string | null;
                    security_posture: "standard" | "restricted_egress";
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/model": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                ai_model: string;
                ai_provider: ModelProvider;
                model: string;
                provider: ModelProvider;
                token_limit: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/model": {
        $patch: {
            input: {
                json: {
                    ai_model?: string | undefined;
                    ai_provider?: string | undefined;
                    provider?: string | undefined;
                    model?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                ai_model: string;
                ai_provider: ModelProvider;
                model: string;
                provider: ModelProvider;
                token_limit: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId": {
        $delete: {
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
    "/:spaceId/sidebar-items": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                items: {
                    label: string;
                    icon: string;
                    path?: string | undefined;
                    url?: string | undefined;
                    extensionId: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:spaceId/sidebar-items">;
export default _default;
//# sourceMappingURL=routes.d.ts.map