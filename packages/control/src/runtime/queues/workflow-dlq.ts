import { createWorkflowEngine } from '../../application/services/execution/workflow-engine.ts';
import { getDb, workflowRuns, workflowJobs } from '../../infra/db/index.ts';
import { eq, and, notInArray } from 'drizzle-orm';
import { isValidWorkflowJobQueueMessage } from '../../shared/types/index.ts';
import { logError, logWarn } from '../../shared/utils/logger.ts';
import type { WorkflowQueueEnv, WorkflowEngineBucket } from './workflow-types.ts';
import { buildSkippedWorkflowStepResultsFromDb, failJobWithResults, markJobFailed } from './workflow-runtime-client.ts';
import { emitWorkflowEvent } from './workflow-events.ts';

// ---------------------------------------------------------------------------
// DLQ handler
// ---------------------------------------------------------------------------

export async function handleWorkflowJobDlq(
  body: unknown,
  env: WorkflowQueueEnv,
  attempts?: number
): Promise<void> {
  if (!isValidWorkflowJobQueueMessage(body)) {
    logError(`CRITICAL: ${JSON.stringify({
      level: 'CRITICAL',
      event: 'WORKFLOW_DLQ_INVALID_MESSAGE',
      timestamp: new Date().toISOString(),
      message: 'Invalid workflow job message format, skipping',
    })}`, undefined, { module: 'workflow_dlq' });
    return;
  }

  const { runId, jobId, repoId, jobKey } = body;
  const timestamp = new Date().toISOString();
  const db = getDb(env.DB);

  const jobRecord = await db.select({ status: workflowJobs.status, name: workflowJobs.name })
    .from(workflowJobs).where(eq(workflowJobs.id, jobId)).get();

  if (!jobRecord || jobRecord.status === 'completed') {
    return;
  }

  // Structured DLQ entry log (matches runner DLQ pattern)
  const dlqEntry = {
    level: 'CRITICAL',
    event: 'WORKFLOW_JOB_DLQ_ENTRY',
    queue: 'takos-workflow-jobs-dlq',
    runId,
    jobId,
    repoId,
    jobKey,
    jobName: jobRecord.name || jobKey,
    timestamp,
    retryCount: attempts ?? null,
  };
  logError(`CRITICAL: ${JSON.stringify(dlqEntry)}`, undefined, { module: 'workflow_dlq' });

  await markJobFailed(env.DB, jobId, timestamp);

  // Also mark the parent workflow run as failed if it is still in progress
  try {
    await db.update(workflowRuns).set({
      status: 'completed',
      conclusion: 'failure',
      completedAt: timestamp,
    }).where(and(eq(workflowRuns.id, runId), notInArray(workflowRuns.status, ['completed', 'cancelled'])));
  } catch (runUpdateErr) {
    logError(`Failed to mark workflow run ${runId} as failed`, runUpdateErr, { module: 'workflow_dlq' });
  }

  const bucket = env.GIT_OBJECTS;
  if (!bucket) {
    await emitWorkflowEvent(env, runId, 'workflow.job.completed', {
      runId,
      jobId,
      repoId,
      jobKey,
      status: 'completed',
      conclusion: 'failure',
      completedAt: timestamp,
      dlq: true,
      attempts: attempts ?? null,
    });
    return;
  }

  const engine = createWorkflowEngine({
    db: env.DB,
    bucket: bucket as unknown as WorkflowEngineBucket,
    queue: env.WORKFLOW_QUEUE,
  });

  try {
    await engine.storeJobLogs(
      jobId,
      [
        'ERROR: Workflow job message reached DLQ (consumer retry exhausted).',
        `runId=${runId}`,
        `jobId=${jobId}`,
        `repoId=${repoId}`,
        `jobKey=${jobKey}`,
        `attempts=${attempts ?? 'unknown'}`,
        `timestamp=${timestamp}`,
      ].join('\n')
    );
  } catch (err) {
    logWarn(`Failed to store DLQ logs for job ${jobId}`, { module: 'workflow_dlq', detail: err });
  }

  const stepResults = await buildSkippedWorkflowStepResultsFromDb(
    env.DB,
    jobId,
    'dlq-failure',
    'Workflow job failed permanently (DLQ)'
  );

  try {
    await failJobWithResults(engine, jobId, stepResults, timestamp);
  } catch (err) {
    logError(`Failed to persist DLQ failure for job ${jobId}`, err, { module: 'workflow_dlq' });
    throw err;
  }

  await emitWorkflowEvent(env, runId, 'workflow.job.completed', {
    runId,
    jobId,
    repoId,
    jobKey,
    status: 'completed',
    conclusion: 'failure',
    completedAt: timestamp,
    dlq: true,
    attempts: attempts ?? null,
  });
}
