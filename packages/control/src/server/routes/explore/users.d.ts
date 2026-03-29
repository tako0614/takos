import type { Env, User } from '../../../shared/types';
type Variables = {
    user?: User;
};
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: Variables;
}, {
    "/users": {
        $get: {
            input: {};
            output: {
                users: {
                    username: string;
                    name: string;
                    avatar_url: string | null;
                    public_repo_count: number;
                }[];
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/users/:username": {
        $get: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                user: {
                    username: string;
                    name: string;
                    avatar_url: string | null;
                    bio: string | null;
                };
                repositories: {
                    id: string;
                    name: string;
                    description: string | null;
                    visibility: string;
                    stars: number;
                    forks: number;
                    created_at: string;
                    updated_at: string;
                    workspace: {
                        slug: string | null;
                        name: string | null;
                    };
                    owner: {
                        username: string;
                        name: string;
                        avatar_url: string | null;
                    };
                    is_starred: boolean;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/users/:username">;
export default _default;
//# sourceMappingURL=users.d.ts.map