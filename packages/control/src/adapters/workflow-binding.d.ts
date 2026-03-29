/**
 * Non-Cloudflare implementation of the Workflow binding.
 *
 * Stores workflow instance state in the database (D1/PostgreSQL).
 * This provides the API surface for `env.MY_WORKFLOW.create()` and
 * instance lifecycle methods. Actual step execution is NOT implemented
 * in this adapter — instances are created with status 'queued' and
 * must be processed by an external runner.
 */
export interface WorkflowInstance {
    id: string;
    pause(): Promise<void>;
    resume(): Promise<void>;
    terminate(): Promise<void>;
    restart(): Promise<void>;
    status(): Promise<WorkflowInstanceStatus>;
}
export interface WorkflowInstanceStatus {
    status: 'queued' | 'running' | 'paused' | 'completed' | 'errored' | 'terminated';
    output?: unknown;
    error?: string;
}
export interface WorkflowBinding {
    create(options?: {
        id?: string;
        params?: unknown;
    }): Promise<WorkflowInstance>;
    get(id: string): Promise<WorkflowInstance>;
}
interface DbLike {
    prepare(query: string): {
        bind(...values: unknown[]): {
            first<T = Record<string, unknown>>(): Promise<T | null>;
            run(): Promise<unknown>;
        };
    };
}
export type WorkflowBindingConfig = {
    db: DbLike;
    serviceId: string;
    workflowName: string;
};
export declare function createWorkflowBinding(config: WorkflowBindingConfig): WorkflowBinding;
export {};
//# sourceMappingURL=workflow-binding.d.ts.map