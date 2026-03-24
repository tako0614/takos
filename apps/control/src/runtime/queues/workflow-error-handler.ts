/**
 * Workflow Job Error Handler.
 *
 * Consolidates the error handling pattern duplicated between
 * workflow-job-handler.ts and workflow-job-phases.ts.
 *
 * The `completeJobFailure` function in workflow-job-phases.ts contains the
 * canonical failure flow:
 * 1. Log the error
 * 2. Mark remaining unprocessed steps as skipped
 * 3. Store job logs
 * 4. Complete the job via engine.onJobComplete
 * 5. Emit a workflow.job.completed event
 *
 * The `handleWorkflowJob` finally block in workflow-job-handler.ts contains
 * the runtime cleanup flow:
 * 1. Check if runtime was configured and started
 * 2. Call runtimeJson to complete the runtime job
 *
 * This module extracts both patterns for reuse.
 */

import type { StepResult } from '@/services/execution/workflow-engine';
import type { JobContext, JobExecutionState } from '@/queues/workflow-types';
import { logError, logWarn } from '@/shared/utils/logger';
import { emitWorkflowEvent } from '@/queues/workflow-events';
import { getStepDisplayName, runtimeJson } from '@/queues/workflow-helpers';

/**
 * Mark remaining unprocessed steps as skipped.
 *
 * Examines `state.stepResults` to determine which step numbers have already
 * been processed, then builds `StepResult` entries for all remaining steps
 * with status/conclusion `'skipped'`.
 *
 * This duplicates the logic from `completeJobFailure` in workflow-job-phases.ts:
 * ```ts
 * const seenSteps = new Set(state.stepResults.map((s) => s.stepNumber));
 * for (let i = 0; i < jobDefinition.steps.length; i++) {
 *   const stepNumber = i + 1;
 *   if (seenSteps.has(stepNumber)) continue;
 *   ...
 * }
 * ```
 */
export function markRemainingStepsSkipped(
  state: JobExecutionState,
  steps: Array<{ name?: string; uses?: string; run?: string; id?: string }>,
): StepResult[] {
  const seenSteps = new Set(state.stepResults.map((s) => s.stepNumber));
  const skipped: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const stepNumber = i + 1;
    if (seenSteps.has(stepNumber)) continue;

    const stepName = getStepDisplayName(steps[i], stepNumber);
    const result: StepResult = {
      stepNumber,
      name: stepName,
      status: 'skipped',
      conclusion: 'skipped',
      outputs: {},
    };
    skipped.push(result);
  }

  return skipped;
}

/**
 * Handle job failure with consistent cleanup.
 *
 * Extracted from `completeJobFailure` in workflow-job-phases.ts.
 * Performs the full failure flow:
 * 1. Sets conclusion to `'failure'`
 * 2. Appends error message and completion timestamp to logs
 * 3. Marks remaining steps as skipped (both in state and via engine)
 * 4. Stores job logs
 * 5. Completes the job record
 * 6. Emits the `workflow.job.completed` event
 */
export async function handleJobFailure(
  ctx: JobContext,
  state: JobExecutionState,
  error: unknown,
): Promise<void> {
  const { jobDefinition, runId, jobId, repoId, jobKey } = ctx.message;

  logError(`Job ${jobId} failed with error`, error, { module: 'queues/workflow-jobs' });

  state.jobConclusion = 'failure';
  const errorMessage = error instanceof Error ? error.message : String(error);
  const completedAt = new Date().toISOString();

  state.logs.push(`Error: ${errorMessage}`);
  state.logs.push(`=== Job completed: failure ===`);
  state.logs.push(`Completed at: ${completedAt}`);

  // Mark remaining steps as skipped
  const skipped = markRemainingStepsSkipped(state, jobDefinition.steps);
  for (const result of skipped) {
    state.stepResults.push(result);
    try {
      await ctx.engine.updateStepStatus(jobId, result.stepNumber, 'skipped', 'skipped');
    } catch (updateErr) {
      logWarn(`Failed to mark step ${result.stepNumber} as skipped`, {
        module: 'queues/workflow-jobs',
        detail: updateErr,
      });
    }
  }

  // Store logs
  try {
    await ctx.engine.storeJobLogs(jobId, state.logs.join('\n'));
  } catch (logErr) {
    logWarn(`Failed to store logs for job ${jobId}`, {
      module: 'queues/workflow-jobs',
      detail: logErr,
    });
  }

  // Complete job
  try {
    await ctx.engine.onJobComplete(jobId, {
      jobId,
      status: 'completed',
      conclusion: 'failure',
      outputs: {},
      stepResults: state.stepResults,
      startedAt: ctx.startedAt,
      completedAt,
    });
    await emitWorkflowEvent(ctx.env, runId, 'workflow.job.completed', {
      runId,
      jobId,
      repoId,
      jobKey,
      name: ctx.jobName,
      status: 'completed',
      conclusion: 'failure',
      completedAt,
    });
  } catch (updateErr) {
    logError(`Failed to persist failure for job ${jobId}`, updateErr, {
      module: 'queues/workflow-jobs',
    });
    throw updateErr;
  }
}

/**
 * Handle runtime cleanup after job execution.
 *
 * Extracted from the `finally` block in `handleWorkflowJob` (workflow-job-handler.ts):
 * ```ts
 * if (runtimeConfigured && state.runtimeStarted) {
 *   if (!state.runtimeCancelled && state.runtimeWorkspaceId) {
 *     await runtimeJson(env, `/actions/jobs/${jobId}/complete`, ...);
 *   }
 * }
 * ```
 *
 * This function is safe to call unconditionally; it checks all preconditions
 * before making any runtime calls.
 */
export async function cleanupRuntime(
  ctx: JobContext,
  state: JobExecutionState,
): Promise<void> {
  if (!ctx.runtimeConfigured || !state.runtimeStarted) return;
  if (state.runtimeCancelled || !state.runtimeWorkspaceId) return;

  try {
    await runtimeJson(ctx.env, `/actions/jobs/${ctx.message.jobId}/complete`, state.runtimeWorkspaceId, {
      conclusion: state.completionConclusion ?? state.jobConclusion,
      uploadLogs: false,
    });
  } catch (err) {
    logWarn(`Failed to complete runtime job ${ctx.message.jobId}`, {
      module: 'queues/workflow-jobs',
      detail: err,
    });
  }
}
