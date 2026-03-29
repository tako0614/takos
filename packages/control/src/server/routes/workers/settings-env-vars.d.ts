import type { AuthenticatedRouteEnv } from '../route-auth';
declare const settingsEnvVars: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/env": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                env: {
                    name: string;
                    type: "plain_text" | "secret_text";
                    value: string;
                    updated_at: string;
                }[];
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/env": {
        $patch: {
            input: {
                json: {
                    variables: {
                        name: string;
                        value: string;
                        secret?: boolean | undefined;
                    }[];
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                env: {
                    name: string;
                    type: "plain_text" | "secret_text";
                    value: string;
                    updated_at: string;
                }[];
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:id/env">;
export default settingsEnvVars;
//# sourceMappingURL=settings-env-vars.d.ts.map