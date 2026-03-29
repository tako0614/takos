import type { AuthenticatedRouteEnv } from '../route-auth';
declare const settingsCommonEnv: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/common-env-links": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                links: {
                    name: string;
                    source: import("../../../application/services/common-env/repository").LinkSource;
                    hasCommonValue: boolean;
                    syncState: import("../../../application/services/common-env/repository").SyncState;
                    syncReason: string | null;
                }[];
                builtins: {
                    [x: string]: {
                        managed: true;
                        available: boolean;
                        configured?: boolean | undefined;
                        scopes?: string[] | undefined;
                        subject_mode?: import("../../../application/services/common-env/takos-builtins").TakosTokenSubjectMode | undefined;
                        sync_state?: "managed" | "pending" | "missing_common" | "missing_builtin" | "overridden" | "error" | undefined;
                        sync_reason?: string | null | undefined;
                    };
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/common-env-links": {
        $put: {
            input: {
                json: {
                    keys?: string[] | undefined;
                    builtins?: {
                        TAKOS_ACCESS_TOKEN?: {
                            scopes: string[];
                        } | undefined;
                    } | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                links: {
                    name: string;
                    source: import("../../../application/services/common-env/repository").LinkSource;
                    hasCommonValue: boolean;
                    syncState: import("../../../application/services/common-env/repository").SyncState;
                    syncReason: string | null;
                }[];
                builtins: {
                    [x: string]: {
                        managed: true;
                        available: boolean;
                        configured?: boolean | undefined;
                        scopes?: string[] | undefined;
                        subject_mode?: import("../../../application/services/common-env/takos-builtins").TakosTokenSubjectMode | undefined;
                        sync_state?: "managed" | "pending" | "missing_common" | "missing_builtin" | "overridden" | "error" | undefined;
                        sync_reason?: string | null | undefined;
                    };
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/common-env-links": {
        $patch: {
            input: {
                json: {
                    set?: string[] | undefined;
                    add?: string[] | undefined;
                    remove?: string[] | undefined;
                    builtins?: {
                        TAKOS_ACCESS_TOKEN?: {
                            scopes: string[];
                        } | undefined;
                    } | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                diff: {
                    added: string[];
                    removed: string[];
                };
                links: {
                    name: string;
                    source: import("../../../application/services/common-env/repository").LinkSource;
                    hasCommonValue: boolean;
                    syncState: import("../../../application/services/common-env/repository").SyncState;
                    syncReason: string | null;
                }[];
                builtins: {
                    [x: string]: {
                        managed: true;
                        available: boolean;
                        configured?: boolean | undefined;
                        scopes?: string[] | undefined;
                        subject_mode?: import("../../../application/services/common-env/takos-builtins").TakosTokenSubjectMode | undefined;
                        sync_state?: "managed" | "pending" | "missing_common" | "missing_builtin" | "overridden" | "error" | undefined;
                        sync_reason?: string | null | undefined;
                    };
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:id/common-env-links">;
export default settingsCommonEnv;
//# sourceMappingURL=settings-common-env.d.ts.map