import type { WorkflowStepResult } from "../../application/services/execution/workflow-engine.ts";
import type { WorkflowJobResult } from "../../application/services/execution/workflow-engine.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import type { JobExecutionState, JobQueueContext } from "./workflow-types.ts";
import {
  getRunStatus,
  getStepDisplayName,
  runtimeDelete,
} from "./workflow-runtime-client.ts";
import {
  evaluateCondition,
  evaluateExpression,
} from "./workflow-expressions.ts";
import { emitWorkflowEvent } from "./workflow-events.ts";
import { executeStep } from "./workflow-steps.ts";

// ---------------------------------------------------------------------------
// Job phase: skip evaluation
// ---------------------------------------------------------------------------

export async function handleJobSkipped(
  ctx: JobQueueContext,
  state: JobExecutionState,
): Promise<boolean> {
  const { jobDefinition } = ctx.message;
  if (!jobDefinition.if) return false;

  const shouldRunJob = evaluateCondition(jobDefinition.if, {
    env: ctx.effectiveJobEnv,
    job: { status: "success" },
    inputs: ctx.runContext.inputs,
  });

  if (shouldRunJob) return false;

  state.jobConclusion = "skipped";
  state.logs.push(`Job skipped (condition not met): ${jobDefinition.if}`);
  state.logs.push("");

  const skippedSteps: WorkflowStepResult[] = jobDefinition.steps.map((
    step,
    index,
  ) => ({
    stepNumber: index + 1,
    name: getStepDisplayName(step, index + 1),
    status: "skipped",
    conclusion: "skipped",
    outputs: {},
  }));

  const completedAt = new Date().toISOString();
  const { runId, jobId, repoId, jobKey } = ctx.message;

  await ctx.engine.storeJobLogs(jobId, state.logs.join("\n"));
  await ctx.engine.onJobComplete(jobId, {
    jobId,
    status: "completed",
    conclusion: "skipped",
    outputs: {},
    stepResults: skippedSteps,
    startedAt: ctx.startedAt,
    completedAt,
  });
  await emitWorkflowEvent(ctx.env, runId, "workflow.job.completed", {
    runId,
    jobId,
    repoId,
    jobKey,
    name: ctx.jobName,
    status: "completed",
    conclusion: "skipped",
    completedAt,
  });

  return true;
}

// ---------------------------------------------------------------------------
// Shared: cancellation emission
// ---------------------------------------------------------------------------

/**
 * Emit the side effects of a cancelled run: mark the conclusion, append the
 * cancellation log lines, cancel the run, tear down the runtime job, persist
 * the logs, and emit the `workflow.job.completed` event with
 * `conclusion: 'cancelled'`.
 *
 * Shared by both the sequential ({@link executeStepLoop}) and parallel
 * (`executeStepLoopParallel`) step loops so cancellation behaviour stays
 * identical. The caller is responsible for stopping its loop and returning
 * `'cancelled'`.
 */
export async function emitCancellation(
  ctx: JobQueueContext,
  state: JobExecutionState,
): Promise<void> {
  const { runId, jobId, repoId, jobKey } = ctx.message;
  state.jobConclusion = "cancelled";
  state.logs.push("Job cancelled (run was cancelled)");
  state.logs.push("");
  await ctx.engine.cancelRun(runId);
  if (state.runtimeStarted) {
    state.runtimeCancelled = true;
    if (state.runtimeSpaceId) {
      await runtimeDelete(
        ctx.env,
        `/actions/jobs/${jobId}`,
        state.runtimeSpaceId,
      );
    }
  }
  await ctx.engine.storeJobLogs(jobId, state.logs.join("\n"));
  await emitWorkflowEvent(ctx.env, runId, "workflow.job.completed", {
    runId,
    jobId,
    repoId,
    jobKey,
    name: ctx.jobName,
    status: "cancelled",
    conclusion: "cancelled",
    completedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Shared: single-step execution body
// ---------------------------------------------------------------------------

/**
 * Execute a single step at the given index, mutating shared `state`.
 *
 * This is the per-step body shared by the sequential ({@link executeStepLoop})
 * and parallel (`executeStepLoopParallel`) loops. It handles condition
 * evaluation, skip logic, the runtime-space guard, step execution, result
 * recording, step status updates, and stdout/stderr/exit-code log emission.
 *
 * The push ordering into `state.logs` and `state.stepResults` is preserved
 * exactly so both loops stay behaviourally identical.
 */
export async function executeOneStep(
  ctx: JobQueueContext,
  state: JobExecutionState,
  stepIndex: number,
): Promise<void> {
  const { jobDefinition, jobId } = ctx.message;
  const step = jobDefinition.steps[stepIndex];
  const stepNumber = stepIndex + 1;
  const stepName = getStepDisplayName(step, stepNumber);

  state.logs.push(`--- Step ${stepNumber}: ${stepName} ---`);

  const stepEnv = { ...ctx.effectiveJobEnv, ...step.env };
  let shouldRun = true;

  if (step.if) {
    shouldRun = evaluateCondition(step.if, {
      env: stepEnv,
      steps: state.stepOutputs,
      job: {
        status: state.jobConclusion === "success" ? "success" : "failure",
      },
      inputs: ctx.runContext.inputs,
    });
  } else if (state.jobConclusion === "failure") {
    shouldRun = false;
  }

  if (!shouldRun) {
    const skippedResult: WorkflowStepResult = {
      stepNumber,
      name: stepName,
      status: "skipped",
      conclusion: "skipped",
      outputs: {},
    };
    state.stepResults.push(skippedResult);
    await ctx.engine.updateStepStatus(
      jobId,
      stepNumber,
      "skipped",
      "skipped",
    );
    state.logs.push(
      step.if
        ? "Skipped (condition not met)"
        : "Skipped (previous step failed)",
    );
    state.logs.push("");
    return;
  }

  await ctx.engine.updateStepStatus(jobId, stepNumber, "in_progress");
  const stepStartedAt = new Date().toISOString();

  const spaceId = state.runtimeSpaceId;
  if (!spaceId) {
    throw new Error(
      "executeOneStep reached step execution before runtimeSpaceId was initialised",
    );
  }
  const result = await executeStep(step, {
    env: ctx.env,
    jobId,
    stepNumber,
    spaceId,
    shell: step.shell ?? jobDefinition.defaults?.run?.shell,
    workingDirectory: step["working-directory"] ??
      jobDefinition.defaults?.run?.["working-directory"],
  });

  const stepCompletedAt = new Date().toISOString();

  const stepResult: WorkflowStepResult = {
    stepNumber,
    name: stepName,
    status: "completed",
    conclusion: result.success ? "success" : "failure",
    exitCode: result.exitCode,
    error: result.error,
    outputs: result.outputs || {},
    startedAt: stepStartedAt,
    completedAt: stepCompletedAt,
  };

  state.stepResults.push(stepResult);

  if (step.id) {
    state.stepOutputs[step.id] = result.outputs || {};
  }

  await ctx.engine.updateStepStatus(
    jobId,
    stepNumber,
    "completed",
    stepResult.conclusion ?? undefined,
    result.exitCode,
    result.error,
  );

  if (result.stdout) {
    state.logs.push(result.stdout);
  }
  if (result.stderr) {
    state.logs.push(`[stderr] ${result.stderr}`);
  }
  if (result.error && !result.stderr) {
    state.logs.push(`Error: ${result.error}`);
  }
  state.logs.push(`Exit code: ${result.exitCode ?? 0}`);
  state.logs.push("");

  if (!result.success && !step["continue-on-error"]) {
    state.jobConclusion = "failure";
  }
}

// ---------------------------------------------------------------------------
// Job phase: step loop execution
// ---------------------------------------------------------------------------

export async function executeStepLoop(
  ctx: JobQueueContext,
  state: JobExecutionState,
): Promise<"cancelled" | void> {
  const { jobDefinition, runId } = ctx.message;

  for (let i = 0; i < jobDefinition.steps.length; i++) {
    const runStatus = await getRunStatus(ctx.env.DB, runId);
    if (runStatus === "cancelled") {
      await emitCancellation(ctx, state);
      return "cancelled";
    }

    await executeOneStep(ctx, state, i);
  }
}

// ---------------------------------------------------------------------------
// Job phase: successful completion
// ---------------------------------------------------------------------------

export async function completeJobSuccess(
  ctx: JobQueueContext,
  state: JobExecutionState,
): Promise<void> {
  const { jobDefinition, runId, jobId, repoId, jobKey } = ctx.message;
  const completedAt = new Date().toISOString();
  const jobContinueOnError = jobDefinition["continue-on-error"] === true;
  const reportedConclusion =
    jobContinueOnError && state.jobConclusion === "failure"
      ? "success"
      : state.jobConclusion;
  state.completionConclusion = reportedConclusion;

  state.logs.push(`=== Job completed: ${state.jobConclusion} ===`);
  if (reportedConclusion !== state.jobConclusion) {
    state.logs.push(
      `Job marked as ${reportedConclusion} due to continue-on-error`,
    );
  }
  state.logs.push(`Completed at: ${completedAt}`);

  await ctx.engine.storeJobLogs(jobId, state.logs.join("\n"));

  const jobOutputs: Record<string, string> = {};
  if (jobDefinition.outputs) {
    for (const [key, expression] of Object.entries(jobDefinition.outputs)) {
      try {
        const value = evaluateExpression(expression, {
          steps: state.stepOutputs,
          inputs: ctx.runContext.inputs,
        });
        if (value) {
          jobOutputs[key] = value;
        }
      } catch (exprErr) {
        logWarn(
          `Failed to evaluate output expression for key "${key}" (expression: ${expression})`,
          { module: "workflow", detail: exprErr },
        );
      }
    }
  }

  const jobResult: WorkflowJobResult = {
    jobId,
    status: reportedConclusion === "cancelled" ? "cancelled" : "completed",
    conclusion: reportedConclusion,
    outputs: jobOutputs,
    stepResults: state.stepResults,
    startedAt: ctx.startedAt,
    completedAt,
  };

  await ctx.engine.onJobComplete(jobId, jobResult);
  await emitWorkflowEvent(ctx.env, runId, "workflow.job.completed", {
    runId,
    jobId,
    repoId,
    jobKey,
    name: ctx.jobName,
    status: reportedConclusion === "cancelled" ? "cancelled" : "completed",
    conclusion: reportedConclusion,
    completedAt,
  });
}

// ---------------------------------------------------------------------------
// Job phase: failure completion
// ---------------------------------------------------------------------------

export async function completeJobFailure(
  ctx: JobQueueContext,
  state: JobExecutionState,
  err: unknown,
): Promise<void> {
  const { jobDefinition, runId, jobId, repoId, jobKey } = ctx.message;

  logError(`Job ${jobId} failed with error`, err, {
    module: "queues/workflow-jobs",
  });

  state.jobConclusion = "failure";
  const errorMessage = err instanceof Error ? err.message : String(err);
  const completedAt = new Date().toISOString();

  state.logs.push(`Error: ${errorMessage}`);
  state.logs.push(`=== Job completed: failure ===`);
  state.logs.push(`Completed at: ${completedAt}`);

  const seenSteps = new Set(state.stepResults.map((s) => s.stepNumber));
  for (let i = 0; i < jobDefinition.steps.length; i++) {
    const stepNumber = i + 1;
    if (seenSteps.has(stepNumber)) continue;
    const stepName = getStepDisplayName(jobDefinition.steps[i], stepNumber);
    const skippedResult: WorkflowStepResult = {
      stepNumber,
      name: stepName,
      status: "skipped",
      conclusion: "skipped",
      outputs: {},
    };
    state.stepResults.push(skippedResult);
    try {
      await ctx.engine.updateStepStatus(
        jobId,
        stepNumber,
        "skipped",
        "skipped",
      );
    } catch (updateErr) {
      logWarn(`Failed to mark step ${stepNumber} as skipped`, {
        module: "queues/workflow-jobs",
        detail: updateErr,
      });
    }
  }

  try {
    await ctx.engine.storeJobLogs(jobId, state.logs.join("\n"));
  } catch (logErr) {
    logWarn(`Failed to store logs for job ${jobId}`, {
      module: "queues/workflow-jobs",
      detail: logErr,
    });
  }

  try {
    await ctx.engine.onJobComplete(jobId, {
      jobId,
      status: "completed",
      conclusion: "failure",
      outputs: {},
      stepResults: state.stepResults,
      startedAt: ctx.startedAt,
      completedAt,
    });
    await emitWorkflowEvent(ctx.env, runId, "workflow.job.completed", {
      runId,
      jobId,
      repoId,
      jobKey,
      name: ctx.jobName,
      status: "completed",
      conclusion: "failure",
      completedAt,
    });
  } catch (updateErr) {
    logError(`Failed to persist failure for job ${jobId}`, updateErr, {
      module: "queues/workflow-jobs",
    });
    throw updateErr;
  }
}
