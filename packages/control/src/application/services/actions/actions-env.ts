import type { Job, Workflow } from '@takoserver/actions-engine';

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
export function buildWorkflowDispatchEnv(options: WorkflowDispatchEnvOptions): Record<string, string> {
  const {
    workflow,
    workflowPath,
    repoId,
    runId,
    ref,
    sha,
    jobKey,
    jobId,
    jobDefinition,
  } = options;

  const workflowEnv = workflow.env || {};
  const normalizedRef = ref.startsWith('refs/') ? ref : `refs/heads/${ref}`;

  return {
    ...workflowEnv,
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: repoId,
    GITHUB_REF: normalizedRef,
    GITHUB_SHA: sha,
    GITHUB_JOB: jobDefinition.name || jobKey || jobId,
    GITHUB_RUN_ID: runId,
    GITHUB_WORKFLOW: workflowPath,
  };
}
