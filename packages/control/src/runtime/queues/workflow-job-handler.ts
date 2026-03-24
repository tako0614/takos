import {
  createWorkflowEngine,
} from '../../application/services/execution/workflow-engine';
import { getDb, workflowRuns, workflowJobs } from '../../infra/db';
import { eq, and } from 'drizzle-orm';
import { logInfo, logWarn } from '../../shared/utils/logger';
import type {
  WorkflowQueueEnv,
  WorkflowEngineBucket,
  RunContext,
  JobContext,
} from './workflow-types';
import { createInitialState } from './workflow-types';
import {
  runtimeJson,
  getRunContext,
  getWorkspaceIdFromRepoId,
  markJobSkipped,
} from './workflow-helpers';
import { resolveSecretValues, collectReferencedSecretNamesFromEnv } from './workflow-secrets';
import { emitWorkflowEvent } from './workflow-events';
import {
  handleJobSkipped,
  executeStepLoop,
  completeJobSuccess,
  completeJobFailure,
} from './workflow-job-phases';
import { executeStepLoopParallel } from './parallel-steps';
import type { WorkflowJobQueueMessage } from '../../shared/types';

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

  const ctx: JobContext = {
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

    state.runtimeWorkspaceId = await getWorkspaceIdFromRepoId(env.DB, repoId);

    await runtimeJson(env, `/actions/jobs/${jobId}/start`, state.runtimeWorkspaceId, {
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
        if (!state.runtimeCancelled && state.runtimeWorkspaceId) {
          await runtimeJson(env, `/actions/jobs/${jobId}/complete`, state.runtimeWorkspaceId, {
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
