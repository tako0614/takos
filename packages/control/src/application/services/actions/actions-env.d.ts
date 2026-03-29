import type { Job, Workflow } from 'takos-actions-engine';
export interface WorkflowDispatchEnvOptions {
    workflow: Workflow;
    workflowPath: string;
    repoId: string;
    runId: string;
    ref: string;
    sha: string;
    jobKey: string;
    jobId: string;
    jobDefinition: Job;
}
/**
 * Build base environment passed from control plane to runtime job.
 *
 * Runtime will still inject authoritative values (workspace path, runner paths),
 * but we include workflow-level env and GitHub context defaults here so the
 * queue payload is self-contained and deterministic.
 */
export declare function buildWorkflowDispatchEnv(options: WorkflowDispatchEnvOptions): Record<string, string>;
//# sourceMappingURL=actions-env.d.ts.map