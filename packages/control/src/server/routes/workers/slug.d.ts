import type { AuthenticatedRouteEnv } from '../route-auth';
declare const workersSlug: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/slug": {
        $patch: {
            input: {
                json: {
                    slug: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                slug: string;
                hostname: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:id/slug">;
export default workersSlug;
//# sourceMappingURL=slug.d.ts.map