import type { Env } from '../../shared/types';
import { type BaseVariables } from './route-auth';
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: BaseVariables;
}, {
    "/notifications": {
        $get: {
            input: {
                query: {
                    limit?: string | undefined;
                    before?: string | undefined;
                };
            };
            output: {
                notifications: {
                    id: string;
                    user_id: string;
                    space_id: string | null;
                    type: string;
                    title: string;
                    body: string | null;
                    data: {
                        [x: string]: import("hono/utils/types").JSONValue;
                    };
                    read_at: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/notifications/unread-count": {
        $get: {
            input: {};
            output: {
                unread_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/notifications/:id/read": {
        $patch: {
            input: {
                param: {
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
} & {
    "/notifications/preferences": {
        $get: {
            input: {};
            output: {
                types: readonly ["deploy.completed", "deploy.failed", "run.completed", "run.failed", "pr.review.requested", "pr.comment", "social.followed", "social.follow.requested", "social.follow.accepted", "workspace.invite", "billing.quota_warning", "security.new_login"];
                channels: readonly ["in_app", "email", "push"];
                preferences: {
                    "run.failed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "deploy.completed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "deploy.failed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "run.completed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "pr.review.requested": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "pr.comment": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "social.followed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "social.follow.requested": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "social.follow.accepted": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "workspace.invite": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "billing.quota_warning": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "security.new_login": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/notifications/preferences": {
        $patch: {
            input: {
                json: {
                    updates: {
                        type: string;
                        enabled: boolean;
                        channel: string;
                    }[];
                };
            };
            output: {
                types: readonly ["deploy.completed", "deploy.failed", "run.completed", "run.failed", "pr.review.requested", "pr.comment", "social.followed", "social.follow.requested", "social.follow.accepted", "workspace.invite", "billing.quota_warning", "security.new_login"];
                channels: readonly ["in_app", "email", "push"];
                preferences: {
                    "run.failed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "deploy.completed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "deploy.failed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "run.completed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "pr.review.requested": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "pr.comment": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "social.followed": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "social.follow.requested": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "social.follow.accepted": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "workspace.invite": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "billing.quota_warning": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                    "security.new_login": {
                        email: boolean;
                        push: boolean;
                        in_app: boolean;
                    };
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/notifications/settings": {
        $get: {
            input: {};
            output: {
                muted_until: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/notifications/settings": {
        $patch: {
            input: {
                json: {
                    muted_until: string | null;
                };
            };
            output: {
                muted_until: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/notifications/ws">;
export default _default;
//# sourceMappingURL=notifications.d.ts.map