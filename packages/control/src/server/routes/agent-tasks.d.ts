import type { Env, AgentTaskStatus } from '../../shared/types';
import type { BaseVariables } from './route-auth';
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: BaseVariables;
}, {
    "/spaces/:spaceId/agent-tasks": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                tasks: {
                    thread_title: string | null;
                    latest_run: {
                        run_id: string;
                        status: import("../../shared/types").RunStatus;
                        agent_type: string;
                        started_at: string | null;
                        completed_at: string | null;
                        created_at: string;
                        error: string | null;
                        artifact_count: number;
                    } | null;
                    resume_target: {
                        thread_id: string;
                        run_id: string | null;
                        reason: "active" | "failed" | "latest" | "thread";
                    } | null;
                    id: string;
                    space_id: string;
                    created_by: string | null;
                    thread_id: string | null;
                    last_run_id: string | null;
                    title: string;
                    description: string | null;
                    status: AgentTaskStatus;
                    priority: import("../../shared/types").AgentTaskPriority;
                    agent_type: string;
                    model: string | null;
                    plan: string | null;
                    due_at: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/agent-tasks": {
        $post: {
            input: {
                json: {
                    title: string;
                    priority?: "low" | "medium" | "high" | "urgent" | undefined;
                    status?: "completed" | "in_progress" | "cancelled" | "planned" | "blocked" | undefined;
                    description?: string | undefined;
                    thread_id?: string | undefined;
                    agent_type?: string | undefined;
                    model?: string | undefined;
                    plan?: string | Record<string, unknown> | undefined;
                    due_at?: string | undefined;
                    create_thread?: boolean | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                task: {
                    thread_title: string | null;
                    latest_run: {
                        run_id: string;
                        status: import("../../shared/types").RunStatus;
                        agent_type: string;
                        started_at: string | null;
                        completed_at: string | null;
                        created_at: string;
                        error: string | null;
                        artifact_count: number;
                    } | null;
                    resume_target: {
                        thread_id: string;
                        run_id: string | null;
                        reason: "active" | "failed" | "latest" | "thread";
                    } | null;
                    id: string;
                    space_id: string;
                    created_by: string | null;
                    thread_id: string | null;
                    last_run_id: string | null;
                    title: string;
                    description: string | null;
                    status: AgentTaskStatus;
                    priority: import("../../shared/types").AgentTaskPriority;
                    agent_type: string;
                    model: string | null;
                    plan: string | null;
                    due_at: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/agent-tasks/:id": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                task: {
                    thread_title: string | null;
                    latest_run: {
                        run_id: string;
                        status: import("../../shared/types").RunStatus;
                        agent_type: string;
                        started_at: string | null;
                        completed_at: string | null;
                        created_at: string;
                        error: string | null;
                        artifact_count: number;
                    } | null;
                    resume_target: {
                        thread_id: string;
                        run_id: string | null;
                        reason: "active" | "failed" | "latest" | "thread";
                    } | null;
                    id: string;
                    space_id: string;
                    created_by: string | null;
                    thread_id: string | null;
                    last_run_id: string | null;
                    title: string;
                    description: string | null;
                    status: AgentTaskStatus;
                    priority: import("../../shared/types").AgentTaskPriority;
                    agent_type: string;
                    model: string | null;
                    plan: string | null;
                    due_at: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/agent-tasks/:id": {
        $patch: {
            input: {
                json: {
                    priority?: "low" | "medium" | "high" | "urgent" | undefined;
                    status?: "completed" | "in_progress" | "cancelled" | "planned" | "blocked" | undefined;
                    description?: string | null | undefined;
                    started_at?: string | null | undefined;
                    completed_at?: string | null | undefined;
                    title?: string | undefined;
                    thread_id?: string | null | undefined;
                    last_run_id?: string | null | undefined;
                    agent_type?: string | undefined;
                    model?: string | null | undefined;
                    plan?: string | Record<string, unknown> | null | undefined;
                    due_at?: string | null | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                task: {
                    thread_title: string | null;
                    latest_run: {
                        run_id: string;
                        status: import("../../shared/types").RunStatus;
                        agent_type: string;
                        started_at: string | null;
                        completed_at: string | null;
                        created_at: string;
                        error: string | null;
                        artifact_count: number;
                    } | null;
                    resume_target: {
                        thread_id: string;
                        run_id: string | null;
                        reason: "active" | "failed" | "latest" | "thread";
                    } | null;
                    id: string;
                    space_id: string;
                    created_by: string | null;
                    thread_id: string | null;
                    last_run_id: string | null;
                    title: string;
                    description: string | null;
                    status: AgentTaskStatus;
                    priority: import("../../shared/types").AgentTaskPriority;
                    agent_type: string;
                    model: string | null;
                    plan: string | null;
                    due_at: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/agent-tasks/:id": {
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
    "/agent-tasks/:id/plan": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                task: {
                    thread_title: string | null;
                    latest_run: {
                        run_id: string;
                        status: import("../../shared/types").RunStatus;
                        agent_type: string;
                        started_at: string | null;
                        completed_at: string | null;
                        created_at: string;
                        error: string | null;
                        artifact_count: number;
                    } | null;
                    resume_target: {
                        thread_id: string;
                        run_id: string | null;
                        reason: "active" | "failed" | "latest" | "thread";
                    } | null;
                    id: string;
                    space_id: string;
                    created_by: string | null;
                    thread_id: string | null;
                    last_run_id: string | null;
                    title: string;
                    description: string | null;
                    status: AgentTaskStatus;
                    priority: import("../../shared/types").AgentTaskPriority;
                    agent_type: string;
                    model: string | null;
                    plan: string | null;
                    due_at: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
                plan: {
                    type: "conversation" | "tool_only" | "code_change" | "composite";
                    tools?: string[] | undefined;
                    needsRepo?: boolean | undefined;
                    repoId?: string | undefined;
                    needsRuntime?: boolean | undefined;
                    usePR?: boolean | undefined;
                    needsReview?: boolean | undefined;
                    reviewType?: "self" | "separate_ai" | undefined;
                    commitMessage?: string | undefined;
                    steps?: {
                        id: string;
                        type: "tool_call" | "code_change" | "review" | "commit" | "pr_create" | "pr_merge";
                        description: string;
                        status: "pending" | "running" | "completed" | "failed" | "skipped";
                        result?: string | undefined;
                        error?: string | undefined;
                    }[] | undefined;
                    reasoning?: string | undefined;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/agent-tasks/:id/plan">;
export default _default;
//# sourceMappingURL=agent-tasks.d.ts.map