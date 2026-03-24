import type { Queue, D1Database } from '../../../shared/types/bindings.ts';
import { createExecutionPlan, type Workflow, type Job } from '@takos/actions-engine';
import { generateId } from '../../../shared/utils';
import { getDb, workflowSecrets, workflowJobs, workflowSteps } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobDefinition,
  type WorkflowJobQueueMessage,
  type WorkflowShell,
} from '../../../shared/types';
import { buildWorkflowDispatchEnv } from './actions-env';
import { logWarn } from '../../../shared/utils/logger';

function normalizeWorkflowShell(shell: string | undefined): WorkflowShell | undefined {
  if (
    shell === 'bash' ||
    shell === 'pwsh' ||
    shell === 'python' ||
    shell === 'sh' ||
    shell === 'cmd' ||
    shell === 'powershell'
  ) {
    return shell;
  }
  return undefined;
}

function toWorkflowJobDefinition(job: Job): WorkflowJobDefinition {
  const defaults: WorkflowJobDefinition['defaults'] = job.defaults?.run
    ? {
        run: {
          shell: normalizeWorkflowShell(job.defaults.run.shell),
          'working-directory': job.defaults.run['working-directory'],
        },
      }
    : undefined;

  return {
    ...job,
    defaults,
    steps: job.steps.map((step) => ({
      ...step,
      shell: normalizeWorkflowShell(step.shell),
    })),
  };
}

export async function getWorkflowSecretIds(
  db: D1Database,
  repoId: string
): Promise<string[]> {
  const drizzle = getDb(db);
  const secretRecords = await drizzle.select({ id: workflowSecrets.id }).from(workflowSecrets).where(eq(workflowSecrets.repoId, repoId)).all();
  return secretRecords.map((s) => s.id);
}

export async function enqueueFirstPhaseJobs(options: {
  queue?: Queue<WorkflowJobQueueMessage>;
  workflow: Workflow;
  workflowPath: string;
  jobKeyToId: Map<string, string>;
  repoId: string;
  runId: string;
  ref: string;
  sha: string;
  db: D1Database;
}) {
  const { queue, workflow, workflowPath, jobKeyToId, repoId, runId, ref, sha, db } = options;

  if (!queue) {
    logWarn('WORKFLOW_QUEUE not configured, workflow jobs will not be enqueued', { module: 'services/actions/actions-execution' });
    return;
  }

  const plan = createExecutionPlan(workflow);
  const firstPhaseJobs = plan.phases[0] || [];
  const secretIds = await getWorkflowSecretIds(db, repoId);

  for (const jobKey of firstPhaseJobs) {
    const jobDef = workflow.jobs[jobKey] as Job | undefined;
    if (!jobDef) continue;

    const jobId = jobKeyToId.get(jobKey);
    if (!jobId) continue;

    const dispatchEnv = buildWorkflowDispatchEnv({
      workflow,
      workflowPath,
      repoId,
      runId,
      ref,
      sha,
      jobKey,
      jobId,
      jobDefinition: jobDef,
    });

    const message: WorkflowJobQueueMessage = {
      version: WORKFLOW_QUEUE_MESSAGE_VERSION,
      type: 'job',
      runId,
      jobId,
      repoId,
      ref,
      sha,
      jobKey,
      jobDefinition: toWorkflowJobDefinition(jobDef),
      env: dispatchEnv,
      secretIds,
      timestamp: Date.now(),
    };

    await queue.send(message);
  }
}

export async function createWorkflowJobs(options: {
  db: D1Database;
  runId: string;
  workflow: Workflow;
  timestamp: string;
}) {
  const { db, runId, workflow, timestamp } = options;
  const drizzle = getDb(db);
  const jobKeyToId = new Map<string, string>();

  const jobDataList: {
    id: string;
    runId: string;
    jobKey: string;
    name: string;
    status: string;
    queuedAt: string;
    createdAt: string;
  }[] = [];

  const stepDataList: {
    id: string;
    jobId: string;
    number: number;
    name: string;
    status: string;
    runCommand: string | null;
    usesAction: string | null;
    createdAt: string;
  }[] = [];

  for (const [jobKey, jobDef] of Object.entries(workflow.jobs)) {
    const jobId = generateId();
    const jobName = jobDef.name || jobKey;
    jobKeyToId.set(jobKey, jobId);

    jobDataList.push({
      id: jobId,
      runId,
      jobKey,
      name: jobName,
      status: 'queued',
      queuedAt: timestamp,
      createdAt: timestamp,
    });

    for (let i = 0; i < jobDef.steps.length; i++) {
      const step = jobDef.steps[i];
      const stepId = generateId();
      const stepName = step.name || step.uses || step.run?.slice(0, 50) || `Step ${i + 1}`;

      stepDataList.push({
        id: stepId,
        jobId,
        number: i + 1,
        name: stepName,
        status: 'pending',
        runCommand: step.run || null,
        usesAction: step.uses || null,
        createdAt: timestamp,
      });
    }
  }

  if (jobDataList.length > 0) {
    await drizzle.insert(workflowJobs).values(jobDataList);
  }
  if (stepDataList.length > 0) {
    await drizzle.insert(workflowSteps).values(stepDataList);
  }

  return jobKeyToId;
}
