import type { Env, MemoryType, ReminderStatus, ReminderTriggerType, ReminderPriority } from '../../shared/types';
import { type BaseVariables } from './route-auth';
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: BaseVariables;
}, {
    "/spaces/:spaceId/memories": {
        $get: {
            input: {
                query: {
                    type?: string | undefined;
                    category?: string | undefined;
                    limit?: string | undefined;
                    offset?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                memories: {
                    id: string;
                    space_id: string;
                    user_id: string | null;
                    thread_id: string | null;
                    type: MemoryType;
                    category: string | null;
                    content: string;
                    summary: string | null;
                    importance: number;
                    tags: string | null;
                    occurred_at: string | null;
                    expires_at: string | null;
                    last_accessed_at: string | null;
                    access_count: number;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/memories/search": {
        $get: {
            input: {
                query: {
                    type?: string | undefined;
                    limit?: string | undefined;
                    q?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                memories: {
                    id: string;
                    space_id: string;
                    user_id: string | null;
                    thread_id: string | null;
                    type: MemoryType;
                    category: string | null;
                    content: string;
                    summary: string | null;
                    importance: number;
                    tags: string | null;
                    occurred_at: string | null;
                    expires_at: string | null;
                    last_accessed_at: string | null;
                    access_count: number;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/memories/:id": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                id: string;
                space_id: string;
                user_id: string | null;
                thread_id: string | null;
                type: MemoryType;
                category: string | null;
                content: string;
                summary: string | null;
                importance: number;
                tags: string | null;
                occurred_at: string | null;
                expires_at: string | null;
                last_accessed_at: string | null;
                access_count: number;
                created_at: string;
                updated_at: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/memories": {
        $post: {
            input: {
                json: {
                    type: "episode" | "semantic" | "procedural";
                    content: string;
                    source?: string | undefined;
                    expires_at?: string | undefined;
                    tags?: string[] | undefined;
                    thread_id?: string | undefined;
                    category?: string | undefined;
                    summary?: string | undefined;
                    importance?: number | undefined;
                    occurred_at?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                id: string;
                space_id: string;
                user_id: string | null;
                thread_id: string | null;
                type: MemoryType;
                category: string | null;
                content: string;
                summary: string | null;
                importance: number;
                tags: string | null;
                occurred_at: string | null;
                expires_at: string | null;
                last_accessed_at: string | null;
                access_count: number;
                created_at: string;
                updated_at: string;
            } | null;
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/memories/:id": {
        $patch: {
            input: {
                json: {
                    expires_at?: string | null | undefined;
                    content?: string | undefined;
                    tags?: string[] | undefined;
                    category?: string | undefined;
                    summary?: string | undefined;
                    importance?: number | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                id: string;
                space_id: string;
                user_id: string | null;
                thread_id: string | null;
                type: MemoryType;
                category: string | null;
                content: string;
                summary: string | null;
                importance: number;
                tags: string | null;
                occurred_at: string | null;
                expires_at: string | null;
                last_accessed_at: string | null;
                access_count: number;
                created_at: string;
                updated_at: string;
            } | null;
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/memories/:id": {
        $delete: {
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
    "/spaces/:spaceId/reminders": {
        $get: {
            input: {
                query: {
                    status?: string | undefined;
                    limit?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                reminders: {
                    id: string;
                    space_id: string;
                    user_id: string | null;
                    content: string;
                    context: string | null;
                    trigger_type: ReminderTriggerType;
                    trigger_value: string | null;
                    status: ReminderStatus;
                    triggered_at: string | null;
                    priority: ReminderPriority;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/reminders/:id": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                id: string;
                space_id: string;
                user_id: string | null;
                content: string;
                context: string | null;
                trigger_type: ReminderTriggerType;
                trigger_value: string | null;
                status: ReminderStatus;
                triggered_at: string | null;
                priority: ReminderPriority;
                created_at: string;
                updated_at: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/reminders": {
        $post: {
            input: {
                json: {
                    content: string;
                    trigger_type: "time" | "condition" | "context";
                    priority?: "low" | "high" | "normal" | "critical" | undefined;
                    context?: string | undefined;
                    trigger_value?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                id: string;
                space_id: string;
                user_id: string | null;
                content: string;
                context: string | null;
                trigger_type: ReminderTriggerType;
                trigger_value: string | null;
                status: ReminderStatus;
                triggered_at: string | null;
                priority: ReminderPriority;
                created_at: string;
                updated_at: string;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/reminders/:id": {
        $patch: {
            input: {
                json: {
                    priority?: "low" | "high" | "normal" | "critical" | undefined;
                    context?: string | undefined;
                    status?: "completed" | "pending" | "triggered" | "dismissed" | undefined;
                    content?: string | undefined;
                    trigger_value?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                id: string;
                space_id: string;
                user_id: string | null;
                content: string;
                context: string | null;
                trigger_type: ReminderTriggerType;
                trigger_value: string | null;
                status: ReminderStatus;
                triggered_at: string | null;
                priority: ReminderPriority;
                created_at: string;
                updated_at: string;
            } | null;
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/reminders/:id": {
        $delete: {
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
    "/reminders/:id/trigger": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                id: string;
                space_id: string;
                user_id: string | null;
                content: string;
                context: string | null;
                trigger_type: ReminderTriggerType;
                trigger_value: string | null;
                status: ReminderStatus;
                triggered_at: string | null;
                priority: ReminderPriority;
                created_at: string;
                updated_at: string;
            } | null;
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/reminders/:id/trigger">;
export default _default;
//# sourceMappingURL=memories.d.ts.map