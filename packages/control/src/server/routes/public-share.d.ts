import type { Env } from '../../shared/types';
type Variables = Record<string, never>;
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: Variables;
}, {
    "/thread-shares/:token": {
        $get: {
            input: {
                param: {
                    token: string;
                };
            };
            output: {
                token: string;
                thread: {
                    id: string;
                    title: string | null;
                    created_at: string;
                    updated_at: string;
                };
                messages: {
                    id: string;
                    role: string;
                    content: string;
                    sequence: number;
                    created_at: string;
                }[];
                share: {
                    mode: import("../../application/services/threads/thread-shares").ThreadShareMode;
                    expires_at: string | null;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/thread-shares/:token/access": {
        $post: {
            input: {
                json: {
                    password?: string | undefined;
                };
            } & {
                param: {
                    token: string;
                };
            };
            output: {
                token: string;
                thread: {
                    id: string;
                    title: string | null;
                    created_at: string;
                    updated_at: string;
                };
                messages: {
                    id: string;
                    role: string;
                    content: string;
                    sequence: number;
                    created_at: string;
                }[];
                share: {
                    mode: import("../../application/services/threads/thread-shares").ThreadShareMode;
                    expires_at: string | null;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/thread-shares/:token/access">;
export default _default;
//# sourceMappingURL=public-share.d.ts.map