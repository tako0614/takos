import type { AuthenticatedRouteEnv } from '../route-auth';
declare const settingsBindings: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/bindings": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                bindings: {
                    id: string;
                    name: string;
                    type: string;
                    resource_id: string;
                    resource_name: string | null;
                }[];
                available_resources: {
                    id: string;
                    name: string;
                    cf_id: string | null;
                    cf_name: string | null;
                }[];
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/bindings": {
        $patch: {
            input: {
                json: {
                    bindings: {
                        type: string;
                        name: string;
                        resource_id?: string | undefined;
                        resource_name?: string | undefined;
                    }[];
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:id/bindings">;
export default settingsBindings;
//# sourceMappingURL=settings-bindings.d.ts.map