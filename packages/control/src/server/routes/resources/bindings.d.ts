import { type AuthenticatedRouteEnv } from '../route-auth';
declare const resourcesBindings: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/bind": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                binding: {
                    id: string;
                    service_id: string;
                    resource_id: string;
                    binding_name: string;
                    binding_type: string;
                    config: string;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:id/bind/:serviceId": {
        $delete: {
            input: {
                param: {
                    id: string;
                } & {
                    serviceId: string;
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
    "/by-name/:name/bind/:serviceId": {
        $delete: {
            input: {
                param: {
                    name: string;
                } & {
                    serviceId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/by-name/:name/bind/:serviceId">;
export default resourcesBindings;
//# sourceMappingURL=bindings.d.ts.map