import {
  createWorkflowEngine,
} from '../../application/services/execution/workflow-engine.ts';
import { getDb, workflowRuns, workflowJobs } from '../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';
import { logInfo, logWarn } from '../../shared/utils/logger.ts';
import type {
  WorkflowQueueEnv,
  WorkflowEngineBucket,
  RunContext,
  JobQueueContext,
} from './workflow-types.ts';
import { createInitialState } from './workflow-types.ts';
import {
  runtimeJson,
  getRunContext,
  getSpaceIdFromRepoId,
  markJobSkipped,
} from './workflow-runtime-client.ts';
import { resolveSecretValues, collectReferencedSecretNamesFromEnv } from './workflow-secrets.ts';
import { emitWorkflowEvent } from './workflow-events.ts';
import {
  handleJobSkipped,
  executeStepLoop,
  completeJobSuccess,
  completeJobFailure,
} from './workflow-job-phases.ts';
import { executeStepLoopParallel } from './parallel-steps.ts';
import type { WorkflowJobQueueMessage } from '../../shared/types/index.ts';

// ---------------------------------------------------------------------------
// Main job handler
// ---------------------------------------------------------------------------

export async function handleWorkflowJob(
  message: WorkflowJobQueueMessage,
  env: WorkflowQueueEnv
): Promise<void> {
  const {
    runId,
    jobId,
    repoId,
    ref,
    sha,
    jobKey,
    jobDefinition,
    env: jobEnv,
    secretIds,
  } = message;

  const bucket = env.GIT_OBJECTS;
  if (!bucket) {
    throw new Error('Git storage not configured');
  }

  const encryptionKey = env.ENCRYPTION_KEY;

  const engine = createWorkflowEngine({
    db: env.DB,
    bucket: bucket as unknown as WorkflowEngineBucket,
    queue: env.WORKFLOW_QUEUE,
  });

  const state = createInitialState();
  const startedAt = new Date().toISOString();
  const jobName = jobDefinition.name || jobKey;
  const effectiveJobEnv = { ...jobEnv, ...(jobDefinition.env || {}) };
  const runtimeConfigured = Boolean(env.RUNTIME_HOST);

  const db = getDb(env.DB);
  const [runRecord, jobRecord] = await Promise.all([
    db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, runId)).get(),
    db.select({ status: workflowJobs.status }).from(workflowJobs).where(eq(workflowJobs.id, jobId)).get(),
  ]);

  if (!runRecord || !jobRecord) {
    logWarn(`Workflow run or job missing (runId=${runId}, jobId=${jobId})`, { module: 'queues/workflow-jobs' });
    return;
  }

  if (jobRecord.status === 'completed') {
    return;
  }

  if (runRecord.status === 'cancelled') {
    await engine.cancelRun(runId);
    return;
  }

  if (runRecord.status === 'completed') {
    await markJobSkipped(env.DB, jobId, startedAt, 'skipped');
    return;
  }

  // Atomically claim the job (optimistic lock)
  const claimResult = await db.update(workflowJobs)
    .set({ status: 'in_progress', startedAt: startedAt })
    .where(and(eq(workflowJobs.id, jobId), eq(workflowJobs.status, 'queued')));
  if (claimResult.meta.changes === 0) {
    logInfo(`Job ${jobId} already claimed, skipping`, { module: 'workflow' });
    return;
  }

  let runContext: RunContext = { workflowPath: 'unknown', inputs: {} };

  try {
    runContext = await getRunContext(env.DB, runId);
  } catch (err) {
    logWarn(`Failed to load run context for ${runId}`, { module: 'queues/workflow-jobs', detail: err });
  }

  const ctx: JobQueueContext = {
    env,
    engine,
    message,
    jobName,
    effectiveJobEnv,
    startedAt,
    runContext,
    runtimeConfigured,
  };

  state.logs.push(`=== Job: ${jobName} ===`);
  state.logs.push(`Started at: ${startedAt}`);
  state.logs.push(`Ref: ${ref}`);
  state.logs.push(`SHA: ${sha}`);
  state.logs.push('');

  try {
    if (await handleJobSkipped(ctx, state)) return;

    const referencedJobEnvSecretNames = collectReferencedSecretNamesFromEnv(effectiveJobEnv);
    const secrets = await resolveSecretValues(
      env.DB,
      repoId,
      secretIds,
      encryptionKey,
      referencedJobEnvSecretNames
    );

    await engine.onJobStart(jobId, 'cloudflare-worker', 'Cloudflare Workers');
    await emitWorkflowEvent(env, runId, 'workflow.job.started', {
      runId,
      jobId,
      repoId,
      jobKey,
      name: jobName,
      startedAt: new Date().toISOString(),
    });

    if (!runtimeConfigured) {
      throw new Error('RUNTIME_HOST binding is required for workflow execution');
    }

    state.runtimeSpaceId = await getSpaceIdFromRepoId(env.DB, repoId);

    await runtimeJson(env, `/actions/jobs/${jobId}/start`, state.runtimeSpaceId, {
      runId,
      repoId,
      ref,
      sha,
      workflowPath: runContext.workflowPath,
      jobName,
      steps: jobDefinition.steps,
      env: effectiveJobEnv,
      secrets,
    });
    state.runtimeStarted = true;

    // Use parallel step execution when enabled via env flag
    const useParallelSteps = Boolean(env.PARALLEL_WORKFLOW_STEPS);
    const stepExecutor = useParallelSteps ? executeStepLoopParallel : executeStepLoop;
    const loopResult = await stepExecutor(ctx, state);
    if (loopResult === 'cancelled') return;

    await completeJobSuccess(ctx, state);
  } catch (err) {
    await completeJobFailure(ctx, state, err);
  } finally {
    if (runtimeConfigured && state.runtimeStarted) {
      try {
        if (!state.runtimeCancelled && state.runtimeSpaceId) {
          await runtimeJson(env, `/actions/jobs/${jobId}/complete`, state.runtimeSpaceId, {
            conclusion: state.completionConclusion ?? state.jobConclusion,
            uploadLogs: false,
          });
        }
      } catch (runtimeErr) {
        logWarn(`Failed to complete runtime job ${jobId}`, { module: 'queues/workflow-jobs', detail: runtimeErr });
      }
    }
  }
}
