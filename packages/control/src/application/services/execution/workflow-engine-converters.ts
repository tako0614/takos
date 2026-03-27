/**
 * Workflow Engine – pure helper / conversion functions
 */

import type { Job } from '@takos/actions-engine';
import { toIsoString } from '../../../shared/utils';
import type { WorkflowJobDefinition, WorkflowShell } from '../../../shared/types';
import type { DrizzleWorkflowRun, WorkflowRunRecord } from './workflow-engine-types';

export function normalizeWorkflowShell(shell: string | undefined): WorkflowShell | undefined {
  if (
    shell === 'bash' ||
    shell === 'pwsh' ||
    shell === 'python' ||
    shell === 'sh' ||
    shell === 'cmd' ||
    shell === 'powershell'
  ) {
    return shell;
  }
  return undefined;
}

export function toWorkflowJobDefinition(job: Job): WorkflowJobDefinition {
  const defaults: WorkflowJobDefinition['defaults'] = job.defaults?.run
    ? {
        run: {
          shell: normalizeWorkflowShell(job.defaults.run.shell),
          'working-directory': job.defaults.run['working-directory'],
        },
      }
    : undefined;

  return {
    ...job,
    defaults,
    steps: job.steps.map((step) => ({
      ...step,
      shell: normalizeWorkflowShell(step.shell),
    })),
  };
}

/**
 * Normalize needs field (string | string[] | undefined) to string[]
 */
export function normalizeNeeds(needs: string | string[] | undefined): string[] {
  if (!needs) return [];
  return Array.isArray(needs) ? needs : [needs];
}

/**
 * Map a Drizzle WorkflowRun record to the snake_case WorkflowRunRecord shape
 */
export function toRunRecord(run: DrizzleWorkflowRun): WorkflowRunRecord {
  return {
    id: run.id,
    repo_id: run.repoId,
    workflow_id: run.workflowId,
    workflow_path: run.workflowPath,
    event: run.event,
    ref: run.ref,
    sha: run.sha,
    actor_id: run.actorAccountId,
    status: run.status,
    conclusion: run.conclusion,
    queued_at: toIsoString(run.queuedAt),
    started_at: toIsoString(run.startedAt),
    completed_at: toIsoString(run.completedAt),
    inputs: run.inputs,
    run_number: run.runNumber,
    run_attempt: run.runAttempt,
    created_at: toIsoString(run.createdAt) ?? new Date(0).toISOString(),
  };
}
