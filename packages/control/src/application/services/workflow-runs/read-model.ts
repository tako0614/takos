import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, workflowRuns, workflowJobs, workflowSteps, accounts } from '../../../infra/db';
import { eq, and, desc, asc } from 'drizzle-orm';
import { safeJsonParseOrDefault } from '../../../shared/utils';

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
      queued_at: (run.queuedAt == null ? null : typeof run.queuedAt === 'string' ? run.queuedAt : run.queuedAt.toISOString()),
      started_at: (run.startedAt == null ? null : typeof run.startedAt === 'string' ? run.startedAt : run.startedAt.toISOString()),
      completed_at: (run.completedAt == null ? null : typeof run.completedAt === 'string' ? run.completedAt : run.completedAt.toISOString()),
      created_at: (run.createdAt == null ? null : typeof run.createdAt === 'string' ? run.createdAt : run.createdAt.toISOString()),
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
      started_at: (job.startedAt == null ? null : typeof job.startedAt === 'string' ? job.startedAt : job.startedAt.toISOString()),
      completed_at: (job.completedAt == null ? null : typeof job.completedAt === 'string' ? job.completedAt : job.completedAt.toISOString()),
      steps: stepsData.map((step) => ({
        number: step.number,
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
        started_at: (step.startedAt == null ? null : typeof step.startedAt === 'string' ? step.startedAt : step.startedAt.toISOString()),
        completed_at: (step.completedAt == null ? null : typeof step.completedAt === 'string' ? step.completedAt : step.completedAt.toISOString()),
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
      queued_at: (runData.queuedAt == null ? null : typeof runData.queuedAt === 'string' ? runData.queuedAt : runData.queuedAt.toISOString()),
      started_at: (runData.startedAt == null ? null : typeof runData.startedAt === 'string' ? runData.startedAt : runData.startedAt.toISOString()),
      completed_at: (runData.completedAt == null ? null : typeof runData.completedAt === 'string' ? runData.completedAt : runData.completedAt.toISOString()),
      created_at: (runData.createdAt == null ? null : typeof runData.createdAt === 'string' ? runData.createdAt : runData.createdAt.toISOString()),
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
      started_at: (job.startedAt == null ? null : typeof job.startedAt === 'string' ? job.startedAt : job.startedAt.toISOString()),
      completed_at: (job.completedAt == null ? null : typeof job.completedAt === 'string' ? job.completedAt : job.completedAt.toISOString()),
    })),
  };
}
