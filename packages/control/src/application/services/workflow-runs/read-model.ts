import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, workflowRuns, workflowJobs, workflowSteps, accounts } from '../../../infra/db';
import { eq, and, desc, asc } from 'drizzle-orm';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import { textDateNullable } from '../../../shared/utils/db-guards';

type ListWorkflowRunsOptions = {
  repoId: string;
  workflow?: string;
  status?: string;
  branch?: string;
  event?: string;
  limit: number;
  offset: number;
};

export async function listWorkflowRuns(db: D1Database, options: ListWorkflowRunsOptions) {
  const drizzle = getDb(db);

  const conditions = [eq(workflowRuns.repoId, options.repoId)];
  if (options.workflow) {
    conditions.push(eq(workflowRuns.workflowPath, options.workflow));
  }
  if (options.status) {
    conditions.push(eq(workflowRuns.status, options.status));
  }
  if (options.branch) {
    conditions.push(eq(workflowRuns.ref, `refs/heads/${options.branch}`));
  }
  if (options.event) {
    conditions.push(eq(workflowRuns.event, options.event));
  }

  const runs = await drizzle.select({
    id: workflowRuns.id,
    workflowPath: workflowRuns.workflowPath,
    event: workflowRuns.event,
    ref: workflowRuns.ref,
    sha: workflowRuns.sha,
    status: workflowRuns.status,
    conclusion: workflowRuns.conclusion,
    runNumber: workflowRuns.runNumber,
    runAttempt: workflowRuns.runAttempt,
    queuedAt: workflowRuns.queuedAt,
    startedAt: workflowRuns.startedAt,
    completedAt: workflowRuns.completedAt,
    createdAt: workflowRuns.createdAt,
    actorAccountId: workflowRuns.actorAccountId,
    actorName: accounts.name,
    actorPicture: accounts.picture,
    actorId: accounts.id,
  })
    .from(workflowRuns)
    .leftJoin(accounts, eq(workflowRuns.actorAccountId, accounts.id))
    .where(and(...conditions))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(options.limit + 1)
    .offset(options.offset)
    .all();

  const hasMore = runs.length > options.limit;
  if (hasMore) runs.pop();

  return {
    runs: runs.map((run) => ({
      id: run.id,
      workflow_path: run.workflowPath,
      event: run.event,
      ref: run.ref,
      sha: run.sha,
      status: run.status,
      conclusion: run.conclusion,
      run_number: run.runNumber,
      run_attempt: run.runAttempt,
      queued_at: textDateNullable(run.queuedAt),
      started_at: textDateNullable(run.startedAt),
      completed_at: textDateNullable(run.completedAt),
      created_at: textDateNullable(run.createdAt),
      actor: run.actorId
        ? {
            id: run.actorId,
            name: run.actorName,
            avatar_url: run.actorPicture,
          }
        : null,
    })),
    has_more: hasMore,
  };
}

export async function getWorkflowRunDetail(db: D1Database, repoId: string, runId: string) {
  const drizzle = getDb(db);
  const runData = await drizzle.select({
    id: workflowRuns.id,
    workflowPath: workflowRuns.workflowPath,
    event: workflowRuns.event,
    ref: workflowRuns.ref,
    sha: workflowRuns.sha,
    status: workflowRuns.status,
    conclusion: workflowRuns.conclusion,
    runNumber: workflowRuns.runNumber,
    runAttempt: workflowRuns.runAttempt,
    inputs: workflowRuns.inputs,
    queuedAt: workflowRuns.queuedAt,
    startedAt: workflowRuns.startedAt,
    completedAt: workflowRuns.completedAt,
    createdAt: workflowRuns.createdAt,
    actorAccountId: workflowRuns.actorAccountId,
    actorName: accounts.name,
    actorPicture: accounts.picture,
  })
    .from(workflowRuns)
    .leftJoin(accounts, eq(workflowRuns.actorAccountId, accounts.id))
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.repoId, repoId)))
    .get();
  if (!runData) return null;

  const jobsData = await drizzle.select()
    .from(workflowJobs)
    .where(eq(workflowJobs.runId, runId))
    .orderBy(asc(workflowJobs.createdAt))
    .all();

  const jobs = await Promise.all(jobsData.map(async (job) => {
    const stepsData = await drizzle.select()
      .from(workflowSteps)
      .where(eq(workflowSteps.jobId, job.id))
      .orderBy(asc(workflowSteps.number))
      .all();

    return {
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      runner_name: job.runnerName,
      started_at: textDateNullable(job.startedAt),
      completed_at: textDateNullable(job.completedAt),
      steps: stepsData.map((step) => ({
        number: step.number,
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
        started_at: textDateNullable(step.startedAt),
        completed_at: textDateNullable(step.completedAt),
      })),
    };
  }));

  return {
    run: {
      id: runData.id,
      workflow_path: runData.workflowPath,
      event: runData.event,
      ref: runData.ref,
      sha: runData.sha,
      status: runData.status,
      conclusion: runData.conclusion,
      run_number: runData.runNumber,
      run_attempt: runData.runAttempt,
      inputs: safeJsonParseOrDefault(runData.inputs, null),
      queued_at: textDateNullable(runData.queuedAt),
      started_at: textDateNullable(runData.startedAt),
      completed_at: textDateNullable(runData.completedAt),
      created_at: textDateNullable(runData.createdAt),
      actor: runData.actorAccountId
        ? {
            id: runData.actorAccountId,
            name: runData.actorName,
            avatar_url: runData.actorPicture,
          }
        : null,
      jobs,
    },
  };
}

export async function getWorkflowRunJobs(db: D1Database, repoId: string, runId: string) {
  const drizzle = getDb(db);
  const run = await drizzle.select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.repoId, repoId)))
    .get();
  if (!run) return null;

  const jobs = await drizzle.select()
    .from(workflowJobs)
    .where(eq(workflowJobs.runId, runId))
    .orderBy(asc(workflowJobs.createdAt))
    .all();

  return {
    jobs: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      runner_name: job.runnerName,
      started_at: textDateNullable(job.startedAt),
      completed_at: textDateNullable(job.completedAt),
    })),
  };
}
