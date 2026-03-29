import type { Env, ThreadStatus, MessageRole } from '../../shared/types';
import { type BaseVariables } from './route-auth';
import { type ThreadShareMode } from '../../application/services/threads/thread-shares';
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: BaseVariables;
}, {
    "/spaces/:spaceId/threads": {
        $get: {
            input: {
                query: {
                    status?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                threads: {
                    id: string;
                    space_id: string;
                    title: string | null;
                    locale?: "ja" | "en" | null | undefined;
                    status: ThreadStatus;
                    summary?: string | null | undefined;
                    key_points?: string | undefined;
                    retrieval_index?: number | undefined;
                    context_window?: number | undefined;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/threads/search": {
        $get: {
            input: {
                query: {
                    type?: string | undefined;
                    limit?: string | undefined;
                    offset?: string | undefined;
                    q?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                query: string;
                type: string;
                results: {
                    kind: "keyword" | "semantic";
                    score?: number | undefined;
                    thread: {
                        id: string;
                        title: string | null;
                        status: ThreadStatus;
                        updated_at: string;
                        created_at: string;
                    };
                    message: {
                        id: string;
                        sequence: number;
                        role: string;
                        created_at: string;
                    };
                    snippet: string;
                    match?: {
                        start: number;
                        end: number;
                    } | null | undefined;
                }[];
                limit: number;
                offset: number;
                semantic_available: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/threads": {
        $post: {
            input: {
                json: {
                    title?: string | undefined;
                    locale?: "en" | "ja" | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                thread: {
                    id: string;
                    space_id: string;
                    title: string | null;
                    locale?: "ja" | "en" | null | undefined;
                    status: ThreadStatus;
                    summary?: string | null | undefined;
                    key_points?: string | undefined;
                    retrieval_index?: number | undefined;
                    context_window?: number | undefined;
                    created_at: string;
                    updated_at: string;
                } | null;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/threads/:id": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                thread: {
                    id: string;
                    space_id: string;
                    title: string | null;
                    locale?: "ja" | "en" | null | undefined;
                    status: ThreadStatus;
                    summary?: string | null | undefined;
                    key_points?: string | undefined;
                    retrieval_index?: number | undefined;
                    context_window?: number | undefined;
                    created_at: string;
                    updated_at: string;
                };
                role: import("../../shared/types").SpaceRole;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/threads/:id/share": {
        $post: {
            input: {
                json: {
                    password?: string | undefined;
                    mode?: string | undefined;
                    expires_at?: string | undefined;
                    expires_in_days?: number | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                share: {
                    id: string;
                    thread_id: string;
                    space_id: string;
                    created_by: string | null;
                    token: string;
                    mode: ThreadShareMode;
                    expires_at: string | null;
                    revoked_at: string | null;
                    last_accessed_at: string | null;
                    created_at: string;
                };
                share_path: string;
                share_url: string;
                password_required: boolean;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/threads/:id/shares": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                shares: {
                    share_path: string;
                    share_url: string;
                    id: string;
                    thread_id: string;
                    space_id: string;
                    created_by: string | null;
                    token: string;
                    mode: ThreadShareMode;
                    expires_at: string | null;
                    revoked_at: string | null;
                    last_accessed_at: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/threads/:id/shares/:shareId/revoke": {
        $post: {
            input: {
                param: {
                    id: string;
                } & {
                    shareId: string;
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
    "/threads/:id": {
        $patch: {
            input: {
                json: {
                    status?: "active" | "archived" | "deleted" | undefined;
                    title?: string | undefined;
                    locale?: "en" | "ja" | null | undefined;
                    context_window?: number | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                thread: {
                    id: string;
                    space_id: string;
                    title: string | null;
                    locale?: "ja" | "en" | null | undefined;
                    status: ThreadStatus;
                    summary?: string | null | undefined;
                    key_points?: string | undefined;
                    retrieval_index?: number | undefined;
                    context_window?: number | undefined;
                    created_at: string;
                    updated_at: string;
                } | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/threads/:id": {
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
    "/threads/:id/archive": {
        $post: {
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
    "/threads/:id/unarchive": {
        $post: {
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
    "/threads/:id/messages": {
        $get: {
            input: {
                query: {
                    limit?: string | undefined;
                    offset?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                messages: {
                    id: string;
                    thread_id: string;
                    role: MessageRole;
                    content: string;
                    tool_calls: string | null;
                    tool_call_id: string | null;
                    metadata: string;
                    sequence: number;
                    created_at: string;
                }[];
                total: number;
                limit: number;
                offset: number;
                activeRun: {
                    id: string;
                    thread_id: string;
                    space_id: string;
                    session_id: string | null;
                    parent_run_id: string | null;
                    child_thread_id: string | null;
                    root_thread_id: string;
                    root_run_id: string | null;
                    agent_type: string;
                    status: import("../../shared/types").RunStatus;
                    input: string;
                    output: string | null;
                    error: string | null;
                    usage: string;
                    worker_id: string | null;
                    worker_heartbeat: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    created_at: string;
                } | null;
                pendingSessionDiff: {
                    sessionId: string;
                    sessionStatus: string;
                    git_mode: boolean;
                } | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/threads/:id/history": {
        $get: {
            input: {
                query: {
                    root_run_id?: string | undefined;
                    limit?: string | undefined;
                    offset?: string | undefined;
                    include_messages?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                messages: {
                    id: string;
                    thread_id: string;
                    role: MessageRole;
                    content: string;
                    tool_calls: string | null;
                    tool_call_id: string | null;
                    metadata: string;
                    sequence: number;
                    created_at: string;
                }[];
                total: number;
                limit: number;
                offset: number;
                runs: {
                    run: {
                        id: string;
                        thread_id: string;
                        space_id: string;
                        session_id: string | null;
                        parent_run_id: string | null;
                        child_thread_id: string | null;
                        root_thread_id: string;
                        root_run_id: string | null;
                        agent_type: string;
                        status: import("../../shared/types").RunStatus;
                        input: string;
                        output: string | null;
                        error: string | null;
                        usage: string;
                        worker_id: string | null;
                        worker_heartbeat: string | null;
                        started_at: string | null;
                        completed_at: string | null;
                        created_at: string;
                    };
                    artifact_count: number;
                    latest_event_at: string;
                    artifacts: {
                        id: string;
                        run_id: string;
                        type: import("../../shared/types").ArtifactType;
                        title: string | null;
                        file_id: string | null;
                        created_at: string;
                    }[];
                    events: {
                        id: number;
                        run_id: string;
                        type: string;
                        data: string;
                        created_at: string;
                    }[];
                    child_thread_id: string | null;
                    child_run_count: number;
                    child_runs: {
                        run_id: string;
                        thread_id: string;
                        child_thread_id: string | null;
                        status: import("../../shared/types").RunStatus;
                        agent_type: string;
                        created_at: string;
                        completed_at: string | null;
                    }[];
                }[];
                focus: {
                    latest_run_id: string | null;
                    latest_active_run_id: string | null;
                    latest_failed_run_id: string | null;
                    latest_completed_run_id: string | null;
                    resume_run_id: string | null;
                };
                activeRun: {
                    id: string;
                    thread_id: string;
                    space_id: string;
                    session_id: string | null;
                    parent_run_id: string | null;
                    child_thread_id: string | null;
                    root_thread_id: string;
                    root_run_id: string | null;
                    agent_type: string;
                    status: import("../../shared/types").RunStatus;
                    input: string;
                    output: string | null;
                    error: string | null;
                    usage: string;
                    worker_id: string | null;
                    worker_heartbeat: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    created_at: string;
                } | null;
                pendingSessionDiff: {
                    sessionId: string;
                    sessionStatus: string;
                    git_mode: boolean;
                } | null;
                taskContext: {
                    id: string;
                    title: string;
                    status: import("../../shared/types").AgentTaskStatus;
                    priority: import("../../shared/types").AgentTaskPriority;
                } | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/threads/:id/messages/search": {
        $get: {
            input: {
                query: {
                    type?: string | undefined;
                    limit?: string | undefined;
                    offset?: string | undefined;
                    q?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                query: string;
                type: string;
                results: {
                    kind: "keyword" | "semantic";
                    score?: number | undefined;
                    message: {
                        id: string;
                        sequence: number;
                        role: string;
                        created_at: string;
                    };
                    snippet: string;
                    match?: {
                        start: number;
                        end: number;
                    } | null | undefined;
                }[];
                limit: number;
                offset: number;
                semantic_available: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/threads/:id/messages": {
        $post: {
            input: {
                json: {
                    role: "user" | "assistant" | "system" | "tool";
                    metadata?: Record<string, unknown> | undefined;
                    content?: string | undefined;
                    tool_calls?: unknown[] | undefined;
                    tool_call_id?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                message: {
                    id: string;
                    thread_id: string;
                    role: MessageRole;
                    content: string;
                    tool_calls: string | null;
                    tool_call_id: string | null;
                    metadata: string;
                    sequence: number;
                    created_at: string;
                } | null;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/threads/:id/export": {
        $get: {
            input: {
                query: {
                    format?: string | undefined;
                    include_internal?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
}, "/", "/threads/:id/export">;
export default _default;
//# sourceMappingURL=threads.d.ts.map