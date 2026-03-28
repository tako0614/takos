/**
 * Workflow Engine – run lifecycle (start, cancel, finalize)
 */

import type { Workflow, Conclusion } from 'takos-actions-engine';
import {
  parseWorkflow,
  validateWorkflow,
  createExecutionPlan,
} from 'takos-actions-engine';
import { generateId, now } from '../../../shared/utils';
import * as gitStore from '../git-smart';
import { getDb, workflowRuns, workflowJobs, workflowSteps, workflows, workflowSecrets } from '../../../infra/db';
import { eq, and, ne, max, inArray, count } from 'drizzle-orm';
import { buildWorkflowDispatchEnv } from '../actions';
import { BadRequestError, InternalError, NotFoundError, ValidationError } from 'takos-common/errors';
import type { WorkflowJobDefinition, WorkflowJobQueueMessage } from '../../../shared/types';
import type { WorkflowBucket, StartRunOptions, WorkflowRunRecord } from './workflow-engine-types';
import type { D1Database, Queue } from '../../../shared/types/bindings.ts';
import { toWorkflowJobDefinition, toRunRecord } from './workflow-engine-converters';
import { WORKFLOW_QUEUE_MESSAGE_VERSION } from '../../../shared/types';
import { logWarn } from '../../../shared/utils/logger';

// ---------------------------------------------------------------------------
// startRun
// ---------------------------------------------------------------------------

export async function startRun(
  db: D1Database,
  bucket: WorkflowBucket,
  queue: Queue<WorkflowJobQueueMessage> | undefined,
  options: StartRunOptions,
): Promise<WorkflowRunRecord> {
  const drizzle = getDb(db);
  const { repoId, workflowPath, event, ref, sha, inputs, actorId } = options;

  const commitSha = await gitStore.resolveRef(db, repoId, ref);
  if (!commitSha) {
    throw new NotFoundError(`Ref ${ref}`);
  }

  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) {
    throw new NotFoundError(`Commit ${commitSha}`);
  }

  const blob = await gitStore.getBlobAtPath(bucket, commit.tree, workflowPath);
  if (!blob) {
    throw new NotFoundError(`Workflow file ${workflowPath}`);
  }

  const content = new TextDecoder().decode(blob);

  const { workflow, diagnostics } = parseWorkflow(content);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    throw new ValidationError(`Workflow parse errors: ${errors.map((e) => e.message).join(', ')}`);
  }

  const validation = validateWorkflow(workflow);
  const validationErrors = validation.diagnostics.filter((d) => d.severity === 'error');
  if (validationErrors.length > 0) {
    throw new ValidationError(`Workflow validation errors: ${validationErrors.map((e) => e.message).join(', ')}`);
  }

  if (!checkTrigger(workflow, event)) {
    throw new BadRequestError(`Workflow does not support event: ${event}`);
  }

  const lastRun = await drizzle.select({ maxRunNumber: max(workflowRuns.runNumber) })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.repoId, repoId), eq(workflowRuns.workflowPath, workflowPath)))
    .get();

  const runNumber = (lastRun?.maxRunNumber || 0) + 1;
  const timestamp = now();
  const runId = generateId();

  const workflowId = await resolveWorkflowId(db, repoId, workflowPath);

  await drizzle.insert(workflowRuns)
    .values({
      id: runId,
      repoId,
      workflowId,
      workflowPath,
      event,
      ref: `refs/heads/${ref}`,
      sha: sha || commitSha,
      actorAccountId: actorId,
      status: 'queued',
      queuedAt: timestamp,
      inputs: inputs ? JSON.stringify(inputs) : null,
      runNumber,
      runAttempt: 1,
      createdAt: timestamp,
    })
    .run();

  const plan = createExecutionPlan(workflow);

  const jobEntries = Object.entries(workflow.jobs).map(([jobKey, jobDef]) => ({
    id: generateId(),
    key: jobKey,
    definition: jobDef,
    name: jobDef.name || jobKey,
  }));

  await Promise.all(jobEntries.map(async (entry) => {
    await drizzle.insert(workflowJobs)
      .values({
        id: entry.id,
        runId,
        jobKey: entry.key,
        name: entry.name,
        status: 'queued',
        queuedAt: timestamp,
        createdAt: timestamp,
      })
      .run();

    await Promise.all(entry.definition.steps.map(async (step, i) => {
      const stepId = generateId();
      const stepName = step.name || step.uses || step.run?.slice(0, 50) || `Step ${i + 1}`;
      await drizzle.insert(workflowSteps)
        .values({
          id: stepId,
          jobId: entry.id,
          number: i + 1,
          name: stepName,
          status: 'pending',
          runCommand: step.run || null,
          usesAction: step.uses || null,
          createdAt: timestamp,
        })
        .run();
      return Promise.resolve();
    }));
  }));

  const jobRecords = jobEntries.map((entry) => ({
    id: entry.id,
    key: entry.key,
    definition: entry.definition,
  }));

  if (queue) {
    const secretIds = await getSecretIds(db, repoId);

    const firstPhaseJobs = plan.phases[0] || [];

    for (const jobKey of firstPhaseJobs) {
      const jobRecord = jobRecords.find((j) => j.key === jobKey);
      if (!jobRecord) continue;

      const queuedJobDefinition: WorkflowJobDefinition = toWorkflowJobDefinition(jobRecord.definition);
      const dispatchEnv = buildWorkflowDispatchEnv({
        workflow,
        workflowPath,
        repoId,
        runId,
        ref,
        sha: sha || commitSha,
        jobKey,
        jobId: jobRecord.id,
        jobDefinition: jobRecord.definition,
      });

      await enqueueJob(queue, {
        runId,
        jobId: jobRecord.id,
        repoId,
        ref,
        sha: sha || commitSha,
        jobKey,
        jobDefinition: queuedJobDefinition,
        env: dispatchEnv,
        secretIds,
      });
    }
  }

  const run = await drizzle.select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .get();

  if (!run) {
    throw new InternalError(`Workflow run not found after creation: ${runId}`);
  }

  return toRunRecord(run);
}

// ---------------------------------------------------------------------------
// cancelRun
// ---------------------------------------------------------------------------

export async function cancelRun(db: D1Database, runId: string): Promise<void> {
  const drizzle = getDb(db);
  const timestamp = now();

  await drizzle.update(workflowRuns)
    .set({
      status: 'cancelled',
      conclusion: 'cancelled',
      completedAt: timestamp,
    })
    .where(
      and(
        eq(workflowRuns.id, runId),
        inArray(workflowRuns.status, ['queued', 'in_progress', 'waiting']),
      )
    )
    .run();

  await drizzle.update(workflowJobs)
    .set({
      status: 'completed',
      conclusion: 'cancelled',
      completedAt: timestamp,
    })
    .where(
      and(
        eq(workflowJobs.runId, runId),
        inArray(workflowJobs.status, ['queued', 'in_progress', 'waiting']),
      )
    )
    .run();

  const jobs = await drizzle.select({ id: workflowJobs.id })
    .from(workflowJobs)
    .where(eq(workflowJobs.runId, runId))
    .all();

  const jobIds = jobs.map(j => j.id);

  if (jobIds.length > 0) {
    await drizzle.update(workflowSteps)
      .set({
        status: 'completed',
        conclusion: 'cancelled',
        completedAt: timestamp,
      })
      .where(
        and(
          inArray(workflowSteps.jobId, jobIds),
          inArray(workflowSteps.status, ['pending', 'in_progress']),
        )
      )
      .run();
  }
}

// ---------------------------------------------------------------------------
// finalizeRunIfComplete
// ---------------------------------------------------------------------------

/**
 * If all jobs for a run are completed, determine and persist the run conclusion.
 */
export async function finalizeRunIfComplete(db: D1Database, runId: string): Promise<void> {
  const drizzle = getDb(db);

  const pendingResult = await drizzle.select({ count: count() })
    .from(workflowJobs)
    .where(and(eq(workflowJobs.runId, runId), ne(workflowJobs.status, 'completed')))
    .get();
  const pendingJobsCount = pendingResult?.count ?? 0;

  if (pendingJobsCount > 0) return;

  const failedResult = await drizzle.select({ count: count() })
    .from(workflowJobs)
    .where(and(eq(workflowJobs.runId, runId), eq(workflowJobs.conclusion, 'failure')))
    .get();
  const failedJobsCount = failedResult?.count ?? 0;

  const cancelledResult = await drizzle.select({ count: count() })
    .from(workflowJobs)
    .where(and(eq(workflowJobs.runId, runId), eq(workflowJobs.conclusion, 'cancelled')))
    .get();
  const cancelledJobsCount = cancelledResult?.count ?? 0;

  let conclusion: Conclusion = 'success';
  if (failedJobsCount > 0) {
    conclusion = 'failure';
  } else if (cancelledJobsCount > 0) {
    conclusion = 'cancelled';
  }

  await drizzle.update(workflowRuns)
    .set({
      status: 'completed',
      conclusion,
      completedAt: now(),
    })
    .where(eq(workflowRuns.id, runId))
    .run();
}

// ---------------------------------------------------------------------------
// Internal helpers used by startRun / cancelRun
// ---------------------------------------------------------------------------

/**
 * Check if the workflow supports the given event
 */
export function checkTrigger(workflow: Workflow, event: string): boolean {
  const on = workflow.on;

  if (typeof on === 'string') {
    return on === event;
  }

  if (Array.isArray(on)) {
    return on.includes(event);
  }

  if (on && typeof on === 'object') {
    return event in on;
  }

  return false;
}

/**
 * Resolve the workflow ID from the database, or return null if not found.
 */
export async function resolveWorkflowId(db: D1Database, repoId: string, workflowPath: string): Promise<string | null> {
  const drizzle = getDb(db);
  const existing = await drizzle.select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.repoId, repoId), eq(workflows.path, workflowPath)))
    .get();
  return existing?.id ?? null;
}

/**
 * Retrieve secret IDs for a repo.
 */
export async function getSecretIds(db: D1Database, repoId: string): Promise<string[]> {
  const drizzle = getDb(db);
  const secretRecords = await drizzle.select({ id: workflowSecrets.id })
    .from(workflowSecrets)
    .where(eq(workflowSecrets.repoId, repoId))
    .all();
  return secretRecords.map((s) => s.id);
}

/**
 * Enqueue a job for execution
 */
export async function enqueueJob(
  queue: Queue<WorkflowJobQueueMessage> | undefined,
  options: {
    runId: string;
    jobId: string;
    repoId: string;
    ref: string;
    sha: string;
    jobKey: string;
    jobDefinition: WorkflowJobDefinition;
    env: Record<string, string>;
    secretIds: string[];
  },
): Promise<void> {
  if (!queue) {
    logWarn('No queue configured, job will not be executed', { module: 'services/execution/workflow-engine' });
    return;
  }

  const message: WorkflowJobQueueMessage = {
    version: WORKFLOW_QUEUE_MESSAGE_VERSION,
    type: 'job',
    runId: options.runId,
    jobId: options.jobId,
    repoId: options.repoId,
    ref: options.ref,
    sha: options.sha,
    jobKey: options.jobKey,
    jobDefinition: options.jobDefinition,
    env: options.env,
    secretIds: options.secretIds,
    timestamp: Date.now(),
  };

  await queue.send(message);
}
