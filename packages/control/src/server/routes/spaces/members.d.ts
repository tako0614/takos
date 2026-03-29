import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { SpaceRole } from '../../../shared/types';
import { type SpaceAccessRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<SpaceAccessRouteEnv, {
    "/:spaceId/members": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                members: {
                    username: string;
                    email: string;
                    name: string;
                    picture: string | null;
                    role: string;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/members": {
        $post: {
            input: {
                json: {
                    email: string;
                    role: string;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                member: {
                    username: string;
                    name: string;
                    picture: string | null;
                    role: SpaceRole;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:spaceId/members/:username": {
        $patch: {
            input: {
                json: {
                    role: string;
                };
            } & {
                param: {
                    spaceId: string;
                } & {
                    username: string;
                };
            };
            output: {
                member: {
                    username: string;
                    name: string;
                    picture: string | null;
                    role: string;
                    created_at: import("hono/utils/types").JSONValue;
                };
            };
            outputFormat: "json";
            status: ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/members/:username": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    username: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: ContentfulStatusCode;
        };
    };
}, "/", "/:spaceId/members/:username">;
export default _default;
//# sourceMappingURL=members.d.ts.map