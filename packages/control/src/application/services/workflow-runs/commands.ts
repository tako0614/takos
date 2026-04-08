import type { D1Database, Queue } from '../../../shared/types/bindings.ts';
import {
  parseWorkflow,
  validateWorkflow,
  type Workflow,
  type WorkflowDiagnostic,
} from 'takos-actions-engine';
import { generateId } from '../../../shared/utils/index.ts';
import { getDb, workflowRuns, workflowJobs, workflowSteps, workflows } from '../../../infra/db/index.ts';
import { eq, and, inArray, max } from 'drizzle-orm';

import { createWorkflowJobs, enqueueFirstPhaseJobs } from '../actions/index.ts';
import { callRuntimeRequest } from '../execution/runtime-request-handler.ts';
import type { Env, WorkflowJobQueueMessage } from '../../../shared/types/index.ts';
import * as gitStore from '../git-smart/index.ts';
import { logError, logWarn } from '../../../shared/utils/logger.ts';

import { toGitBucket } from '../../../shared/utils/git-bucket.ts';
import type { GitBucket } from '../../../shared/utils/git-bucket.ts';

type WorkflowLoadResult =
  | { ok: true; workflow: Workflow }
  | { ok: false; error: { message: string; details: string[] } };

type WorkflowBlobResult =
  | { ok: true; commitSha: string; content: string }
  | { ok: false; errorMessage: string };

function castGitBucket<T>(bucket: GitBucket): T {
  return bucket as unknown as T;
}

function getCommitData(bucket: GitBucket, sha: string) {
  return gitStore.getCommitData(castGitBucket<Parameters<typeof gitStore.getCommitData>[0]>(bucket), sha);
}

function getBlobAtPath(bucket: GitBucket, rootTreeSha: string, path: string) {
  return gitStore.getBlobAtPath(
    castGitBucket<Parameters<typeof gitStore.getBlobAtPath>[0]>(bucket),
    rootTreeSha,
    path,
  );
}

function filterErrors(diagnostics: WorkflowDiagnostic[]): WorkflowDiagnostic[] {
  return diagnostics.filter((d) => d.severity === 'error');
}

function loadAndValidateWorkflow(content: string): WorkflowLoadResult {
  const { workflow, diagnostics } = parseWorkflow(content);
  const parseErrors = filterErrors(diagnostics);
  if (parseErrors.length > 0) {
    return { ok: false, error: { message: 'Workflow parse error', details: parseErrors.map((e) => e.message) } };
  }

  const validation = validateWorkflow(workflow);
  const validationErrors = filterErrors(validation.diagnostics);
  if (validationErrors.length > 0) {
    return { ok: false, error: { message: 'Workflow validation error', details: validationErrors.map((e) => e.message) } };
  }

  return { ok: true, workflow };
}

function hasWorkflowDispatch(on: Workflow['on']): boolean {
  if (typeof on === 'string') return on === 'workflow_dispatch';
  if (Array.isArray(on)) return on.includes('workflow_dispatch');
  return on != null && 'workflow_dispatch' in on;
}

async function safeEnqueueFirstPhaseJobs(options: {
  queue: Queue<WorkflowJobQueueMessage> | undefined;
  workflow: Workflow;
  workflowPath: string;
  jobKeyToId: Map<string, string>;
  repoId: string;
  runId: string;
  ref: string;
  sha: string;
  db: D1Database;
  logLabel: string;
}): Promise<void> {
  const { logLabel, ...enqueueOptions } = options;
  try {
    await enqueueFirstPhaseJobs(enqueueOptions);
  } catch (err) {
    logError(`Failed to enqueue ${logLabel}`, err, { module: 'services/workflow-runs/commands' });
  }
}

async function resolveWorkflowBlob(
  db: D1Database,
  bucket: GitBucket,
  repoId: string,
  refName: string,
  workflowPath: string,
  errorLabel: string,
): Promise<WorkflowBlobResult> {
  const commitSha = await gitStore.resolveRef(db, repoId, refName);
  if (!commitSha) {
    return { ok: false, errorMessage: `Ref not found${errorLabel}` };
  }

  const commit = await getCommitData(bucket, commitSha);
  if (!commit) {
    return { ok: false, errorMessage: `Commit not found${errorLabel}` };
  }

  const blob = await getBlobAtPath(bucket, commit.tree, workflowPath);
  if (!blob) {
    return { ok: false, errorMessage: `Workflow file not found${errorLabel}` };
  }

  return { ok: true, commitSha, content: new TextDecoder().decode(blob) };
}

export async function dispatchWorkflowRun(
  env: Env,
  params: {
    repoId: string;
    workflowPath: string;
    refName: string;
    actorId: string;
    inputs?: Record<string, unknown>;
  },
) {
  const bucket = env.GIT_OBJECTS ? toGitBucket(env.GIT_OBJECTS) : undefined;
  if (!bucket) return { ok: false as const, status: 500 as const, error: 'Git storage not configured' };
  if (!env.WORKFLOW_QUEUE) return { ok: false as const, status: 500 as const, error: 'Workflow queue not configured' };

  const resolved = await resolveWorkflowBlob(env.DB, bucket, params.repoId, params.refName, params.workflowPath, '');
  if (!resolved.ok) return { ok: false as const, status: 404 as const, error: resolved.errorMessage };

  const result = loadAndValidateWorkflow(resolved.content);
  if (!result.ok) return { ok: false as const, status: 400 as const, error: result.error.message, details: result.error.details };
  if (!hasWorkflowDispatch(result.workflow.on)) {
    return {
      ok: false as const,
      status: 400 as const,
      error: 'Workflow does not support manual dispatch',
      details: ['Add workflow_dispatch to the workflow triggers'],
    };
  }

  const db = getDb(env.DB);
  const lastRun = await db.select({ maxRunNumber: max(workflowRuns.runNumber) })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.repoId, params.repoId), eq(workflowRuns.workflowPath, params.workflowPath)))
    .get();

  const runNumber = (lastRun?.maxRunNumber || 0) + 1;
  const timestamp = new Date().toISOString();
  const runId = generateId();
  const existingWorkflow = await db.select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.repoId, params.repoId), eq(workflows.path, params.workflowPath)))
    .get();

  await db.insert(workflowRuns)
    .values({
      id: runId,
      repoId: params.repoId,
      workflowId: existingWorkflow?.id ?? null,
      workflowPath: params.workflowPath,
      event: 'workflow_dispatch',
      ref: `refs/heads/${params.refName}`,
      sha: resolved.commitSha,
      actorAccountId: params.actorId,
      status: 'queued',
      queuedAt: timestamp,
      inputs: params.inputs ? JSON.stringify(params.inputs) : null,
      runNumber,
      runAttempt: 1,
      createdAt: timestamp,
    })
    .run();

  const jobKeyToId = await createWorkflowJobs({
    db: env.DB,
    runId,
    workflow: result.workflow,
    timestamp,
  });

  await safeEnqueueFirstPhaseJobs({
    queue: env.WORKFLOW_QUEUE,
    workflow: result.workflow,
    workflowPath: params.workflowPath,
    jobKeyToId,
    repoId: params.repoId,
    runId,
    ref: params.refName,
    sha: resolved.commitSha,
    db: env.DB,
    logLabel: 'workflow jobs',
  });

  return {
    ok: true as const,
    status: 201 as const,
    run: {
      id: runId,
      workflow_path: params.workflowPath,
      event: 'workflow_dispatch',
      ref: `refs/heads/${params.refName}`,
      sha: resolved.commitSha,
      status: 'queued',
      run_number: runNumber,
      run_attempt: 1,
      queued_at: timestamp,
      created_at: timestamp,
    },
  };
}

export async function cancelWorkflowRun(
  env: Env,
  params: { repoId: string; runId: string },
) {
  const db = getDb(env.DB);
  const run = await db.select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, params.runId), eq(workflowRuns.repoId, params.repoId)))
    .get();
  if (!run) return { ok: false as const, status: 404 as const, error: 'Run not found' };
  if (run.status === 'completed' || run.status === 'cancelled') {
    return { ok: false as const, status: 400 as const, error: 'Run is already completed or cancelled' };
  }

  const runningJobs = await db.select({ id: workflowJobs.id })
    .from(workflowJobs)
    .where(and(eq(workflowJobs.runId, params.runId), eq(workflowJobs.status, 'in_progress')))
    .all();
  const timestamp = new Date().toISOString();

  await db.update(workflowRuns)
    .set({ status: 'cancelled', conclusion: 'cancelled', completedAt: timestamp })
    .where(eq(workflowRuns.id, params.runId))
    .run();
  await db.update(workflowJobs)
    .set({ status: 'cancelled', conclusion: 'cancelled', completedAt: timestamp })
    .where(and(eq(workflowJobs.runId, params.runId), inArray(workflowJobs.status, ['queued', 'in_progress'])))
    .run();

  const jobIds = await db.select({ id: workflowJobs.id })
    .from(workflowJobs)
    .where(eq(workflowJobs.runId, params.runId))
    .all();
  await db.update(workflowSteps)
    .set({ status: 'cancelled', conclusion: 'cancelled', completedAt: timestamp })
    .where(and(inArray(workflowSteps.jobId, jobIds.map((job) => job.id)), inArray(workflowSteps.status, ['pending', 'in_progress'])))
    .run();

  if (runningJobs.length > 0 && env.RUNTIME_HOST) {
    for (const job of runningJobs) {
      try {
        await callRuntimeRequest(env, `/actions/jobs/${job.id}`, { method: 'DELETE' });
      } catch (err) {
        logWarn(`Failed to cancel runtime job ${job.id}`, { module: 'services/workflow-runs/commands', detail: err });
      }
    }
  }

  return { ok: true as const, status: 200 as const, cancelled: true };
}

export async function rerunWorkflowRun(
  env: Env,
  params: { repoId: string; runId: string; actorId: string; defaultBranch: string },
) {
  const db = getDb(env.DB);
  const run = await db.select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, params.runId), eq(workflowRuns.repoId, params.repoId)))
    .get();
  if (!run) return { ok: false as const, status: 404 as const, error: 'Run not found' };
  if (run.status !== 'completed' && run.status !== 'cancelled') {
    return { ok: false as const, status: 400 as const, error: 'Can only re-run completed or cancelled runs' };
  }

  const bucket = env.GIT_OBJECTS ? toGitBucket(env.GIT_OBJECTS) : undefined;
  if (!bucket) return { ok: false as const, status: 500 as const, error: 'Git storage not configured' };
  if (!env.WORKFLOW_QUEUE) return { ok: false as const, status: 500 as const, error: 'Workflow queue not configured' };

  const refValue = run.ref?.replace('refs/heads/', '') || run.ref || params.defaultBranch || 'main';
  const commitSha = run.sha || await gitStore.resolveRef(env.DB, params.repoId, refValue);
  if (!commitSha) return { ok: false as const, status: 404 as const, error: 'Ref not found for workflow rerun' };

  const resolved = await resolveWorkflowBlob(env.DB, bucket, params.repoId, refValue, run.workflowPath, ' for workflow rerun');
  if (!resolved.ok) return { ok: false as const, status: 404 as const, error: resolved.errorMessage };

  const parsed = loadAndValidateWorkflow(resolved.content);
  if (!parsed.ok) return { ok: false as const, status: 400 as const, error: parsed.error.message, details: parsed.error.details };

  const timestamp = new Date().toISOString();
  const newRunId = generateId();
  const newAttempt = run.runAttempt + 1;

  await db.insert(workflowRuns)
    .values({
      id: newRunId,
      repoId: params.repoId,
      workflowId: run.workflowId,
      workflowPath: run.workflowPath,
      event: run.event,
      ref: refValue,
      sha: commitSha,
      actorAccountId: params.actorId,
      status: 'queued',
      queuedAt: timestamp,
      inputs: run.inputs,
      runNumber: run.runNumber,
      runAttempt: newAttempt,
      createdAt: timestamp,
    })
    .run();

  const jobKeyToId = await createWorkflowJobs({
    db: env.DB,
    runId: newRunId,
    workflow: parsed.workflow,
    timestamp,
  });

  await safeEnqueueFirstPhaseJobs({
    queue: env.WORKFLOW_QUEUE,
    workflow: parsed.workflow,
    workflowPath: run.workflowPath,
    jobKeyToId,
    repoId: params.repoId,
    runId: newRunId,
    ref: refValue,
    sha: commitSha,
    db: env.DB,
    logLabel: 'workflow rerun jobs',
  });

  return {
    ok: true as const,
    status: 201 as const,
    run: {
      id: newRunId,
      workflow_path: run.workflowPath,
      event: run.event,
      ref: refValue,
      sha: commitSha,
      status: 'queued',
      run_number: run.runNumber,
      run_attempt: newAttempt,
      queued_at: timestamp,
      created_at: timestamp,
    },
  };
}
