import type { AuthenticatedRouteEnv } from '../route-auth';
declare const settingsConfig: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/settings": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                compatibility_date: string | undefined;
                compatibility_flags: string[];
                limits: {
                    cpu_ms?: number | undefined;
                    subrequests?: number | undefined;
                };
                mcp_server: {
                    enabled: boolean;
                    name: string;
                    path: string;
                } | undefined;
                applies_on_next_deploy: true;
                updated_at: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/settings": {
        $patch: {
            input: {
                json: {
                    compatibility_date?: string | undefined;
                    compatibility_flags?: string[] | undefined;
                    limits?: {
                        cpu_ms?: number | undefined;
                        subrequests?: number | undefined;
                    } | undefined;
                    mcp_server?: {
                        name: string;
                        path: string;
                        enabled: boolean;
                    } | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                settings: {
                    compatibility_date: string | undefined;
                    compatibility_flags: string[];
                    limits: {
                        cpu_ms?: number | undefined;
                        subrequests?: number | undefined;
                    };
                    mcp_server: {
                        enabled: boolean;
                        name: string;
                        path: string;
                    } | undefined;
                    updated_at: string | null;
                };
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:id/settings">;
export default settingsConfig;
//# sourceMappingURL=settings-config.d.ts.map