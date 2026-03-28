/**
 * Workflow Engine – job scheduling, dependency evaluation, and status updates
 */

import type { Workflow } from '@takos/actions-engine';
import type { Conclusion } from '@takos/actions-engine';
import { parseWorkflow } from '@takos/actions-engine';
import { now } from '../../../shared/utils';
import * as gitStore from '../git-smart';
import { getDb, workflowRuns, workflowJobs, workflowSteps } from '../../../infra/db';
import { eq, and, ne, or, count } from 'drizzle-orm';
import { buildWorkflowDispatchEnv } from '../actions';
import type { WorkflowJobDefinition, WorkflowJobQueueMessage } from '../../../shared/types';
import type { D1Database, Queue } from '../../../shared/types/bindings.ts';
import type { WorkflowBucket, WorkflowJobResult, DependencyState } from './workflow-engine-types';
import { toWorkflowJobDefinition, normalizeNeeds } from './workflow-engine-converters';
import { finalizeRunIfComplete, enqueueJob, getSecretIds } from './workflow-run-lifecycle';

// ---------------------------------------------------------------------------
// onJobComplete
// ---------------------------------------------------------------------------

export async function onJobComplete(
  db: D1Database,
  bucket: WorkflowBucket,
  queue: Queue<WorkflowJobQueueMessage> | undefined,
  jobId: string,
  result: WorkflowJobResult,
): Promise<void> {
  const drizzle = getDb(db);

  await drizzle.update(workflowJobs)
    .set({
      status: 'completed',
      conclusion: result.conclusion,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
    })
    .where(eq(workflowJobs.id, jobId))
    .run();

  await Promise.all(result.stepResults.map((stepResult) =>
    drizzle.update(workflowSteps)
      .set({
        status: stepResult.status,
        conclusion: stepResult.conclusion,
        exitCode: stepResult.exitCode ?? null,
        errorMessage: stepResult.error ?? null,
        startedAt: stepResult.startedAt ?? null,
        completedAt: stepResult.completedAt ?? null,
      })
      .where(and(eq(workflowSteps.jobId, jobId), eq(workflowSteps.number, stepResult.stepNumber)))
      .run()
  ));

  const job = await drizzle.select()
    .from(workflowJobs)
    .where(eq(workflowJobs.id, jobId))
    .get();

  if (!job) return;

  const runId = job.runId;
  const completedJobKey = job.jobKey || job.name;

  const pendingJobsResult = await drizzle.select({ count: count() })
    .from(workflowJobs)
    .where(and(eq(workflowJobs.runId, runId), ne(workflowJobs.status, 'completed')))
    .get();
  const pendingJobsCount = pendingJobsResult?.count ?? 0;

  if (pendingJobsCount === 0) {
    await finalizeRunIfComplete(db, runId);
  } else {
    await scheduleDependentJobs(db, bucket, queue, runId, completedJobKey);
  }
}

// ---------------------------------------------------------------------------
// scheduleDependentJobs
// ---------------------------------------------------------------------------

export async function scheduleDependentJobs(
  db: D1Database,
  bucket: WorkflowBucket,
  queue: Queue<WorkflowJobQueueMessage> | undefined,
  runId: string,
  completedJobKey: string,
): Promise<void> {
  const drizzle = getDb(db);

  const run = await drizzle.select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .get();

  if (!run || !queue) return;

  const workflow = await loadWorkflowFromGit(db, bucket, run.repoId, run.workflowPath, run.sha, run.ref);
  if (!workflow) return;

  for (const [jobKey, jobDef] of Object.entries(workflow.jobs)) {
    const needs = normalizeNeeds(jobDef.needs);

    if (!needs.includes(completedJobKey)) continue;

    const dependencyState = await evaluateDependencies(db, runId, needs);
    if (!dependencyState.allCompleted) {
      continue;
    }

    const jobRecord = await findJobRecordByKey(db, runId, jobKey, jobDef.name);

    if (!dependencyState.allSuccessful) {
      if (jobRecord) {
        await skipJobAndSteps(db, jobRecord.id);
        await scheduleDependentJobs(db, bucket, queue, runId, jobKey);
      }
      continue;
    }

    if (jobRecord) {
      const secretIds = await getSecretIds(db, run.repoId);
      const dispatchRef = run.ref?.replace('refs/heads/', '') || run.ref || 'main';
      const queuedJobDefinition: WorkflowJobDefinition = toWorkflowJobDefinition(jobDef);
      const dispatchEnv = buildWorkflowDispatchEnv({
        workflow,
        workflowPath: run.workflowPath,
        repoId: run.repoId,
        runId,
        ref: dispatchRef,
        sha: run.sha || '',
        jobKey,
        jobId: jobRecord.id,
        jobDefinition: jobDef,
      });

      await enqueueJob(queue, {
        runId,
        jobId: jobRecord.id,
        repoId: run.repoId,
        ref: dispatchRef,
        sha: run.sha || '',
        jobKey,
        jobDefinition: queuedJobDefinition,
        env: dispatchEnv,
        secretIds,
      });
    }
  }

  await finalizeRunIfComplete(db, runId);
}

// ---------------------------------------------------------------------------
// evaluateDependencies
// ---------------------------------------------------------------------------

/**
 * Evaluate dependency completion and success as a set.
 */
export async function evaluateDependencies(
  db: D1Database,
  runId: string,
  needs: string[],
): Promise<DependencyState> {
  const drizzle = getDb(db);

  for (const dep of needs) {
    const depJob = await drizzle.select({ status: workflowJobs.status, conclusion: workflowJobs.conclusion })
      .from(workflowJobs)
      .where(
        and(
          eq(workflowJobs.runId, runId),
          or(
            eq(workflowJobs.jobKey, dep),
            eq(workflowJobs.name, dep),
          ),
        )
      )
      .get();

    if (!depJob || depJob.status !== 'completed') {
      return { allCompleted: false, allSuccessful: false };
    }

    if (depJob.conclusion !== 'success') {
      return { allCompleted: true, allSuccessful: false };
    }
  }

  return { allCompleted: true, allSuccessful: true };
}

// ---------------------------------------------------------------------------
// onJobStart
// ---------------------------------------------------------------------------

export async function onJobStart(
  db: D1Database,
  jobId: string,
  runnerId?: string,
  runnerName?: string,
): Promise<void> {
  const drizzle = getDb(db);
  const timestamp = now();

  await drizzle.update(workflowJobs)
    .set({
      status: 'in_progress',
      startedAt: timestamp,
      runnerId: runnerId ?? null,
      runnerName: runnerName ?? null,
    })
    .where(eq(workflowJobs.id, jobId))
    .run();

  const job = await drizzle.select({ runId: workflowJobs.runId })
    .from(workflowJobs)
    .where(eq(workflowJobs.id, jobId))
    .get();

  if (job) {
    await drizzle.update(workflowRuns)
      .set({ status: 'in_progress', startedAt: timestamp })
      .where(and(eq(workflowRuns.id, job.runId), eq(workflowRuns.status, 'queued')))
      .run();
  }
}

// ---------------------------------------------------------------------------
// updateStepStatus
// ---------------------------------------------------------------------------

export async function updateStepStatus(
  db: D1Database,
  jobId: string,
  stepNumber: number,
  status: 'in_progress' | 'completed' | 'skipped',
  conclusion?: Conclusion,
  exitCode?: number,
  error?: string,
): Promise<void> {
  const drizzle = getDb(db);
  const timestamp = now();
  const startedAt = status === 'in_progress' ? timestamp : undefined;
  const completedAt = status === 'completed' || status === 'skipped' ? timestamp : undefined;

  await drizzle.update(workflowSteps)
    .set({
      status,
      conclusion: conclusion ?? null,
      exitCode: exitCode ?? null,
      errorMessage: error ?? null,
      startedAt,
      completedAt,
    })
    .where(and(eq(workflowSteps.jobId, jobId), eq(workflowSteps.number, stepNumber)))
    .run();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load and parse a workflow definition from the git store.
 * Returns null if any step in the resolution chain fails.
 */
async function loadWorkflowFromGit(
  db: D1Database,
  bucket: WorkflowBucket,
  repoId: string,
  workflowPath: string,
  runSha: string | null,
  ref: string | null,
): Promise<Workflow | null> {
  let commitSha = runSha;
  if (!commitSha) {
    const resolvedRef = ref?.replace('refs/heads/', '') || 'main';
    commitSha = await gitStore.resolveRef(db, repoId, resolvedRef);
    if (!commitSha) return null;
  }

  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) return null;

  const blob = await gitStore.getBlobAtPath(bucket, commit.tree, workflowPath);
  if (!blob) return null;

  const content = new TextDecoder().decode(blob);
  const { workflow } = parseWorkflow(content);
  return workflow;
}

/**
 * Find a job record by run ID and job key (or job name as fallback).
 */
async function findJobRecordByKey(
  db: D1Database,
  runId: string,
  jobKey: string,
  jobName?: string,
): Promise<{ id: string } | null> {
  const drizzle = getDb(db);
  return await drizzle.select({ id: workflowJobs.id })
    .from(workflowJobs)
    .where(
      and(
        eq(workflowJobs.runId, runId),
        or(
          eq(workflowJobs.jobKey, jobKey),
          eq(workflowJobs.name, jobName || jobKey),
        ),
      )
    )
    .get() ?? null;
}

/**
 * Mark a job and all its steps as skipped.
 */
async function skipJobAndSteps(db: D1Database, jobId: string): Promise<void> {
  const drizzle = getDb(db);
  const ts = now();

  await drizzle.update(workflowJobs)
    .set({
      status: 'completed',
      conclusion: 'skipped',
      completedAt: ts,
    })
    .where(eq(workflowJobs.id, jobId))
    .run();

  await drizzle.update(workflowSteps)
    .set({
      status: 'skipped',
      conclusion: 'skipped',
      completedAt: ts,
    })
    .where(eq(workflowSteps.jobId, jobId))
    .run();
}
