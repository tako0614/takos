import type { ResourcePermission } from '../../../shared/types';
import { type AuthenticatedRouteEnv } from '../route-auth';
declare const resourcesAccess: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:id/access": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                access: {
                    workspace_name: string | null;
                    id: string;
                    resource_id: string;
                    space_id: string;
                    permission: ResourcePermission;
                    granted_by: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/access": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                message: string;
                permission: ResourcePermission | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                access: {
                    id: string;
                    resource_id: string;
                    space_id: string;
                    permission: ResourcePermission;
                    granted_by: string;
                    created_at: string;
                } | undefined;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:id/access/:spaceId": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    id: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:id/access/:spaceId">;
export default resourcesAccess;
//# sourceMappingURL=access.d.ts.map