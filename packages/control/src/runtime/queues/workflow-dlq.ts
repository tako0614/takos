import { createWorkflowEngine } from "../../application/services/execution/workflow-engine.ts";
import {
  getDb,
  workflowJobs,
  workflowRuns,
  workflowSteps,
} from "../../infra/db/index.ts";
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { isValidWorkflowJobQueueMessage } from "../../shared/types/index.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import type { WorkflowQueueEnv } from "./workflow-types.ts";
import {
  buildSkippedWorkflowStepResultsFromDb,
  failJobWithResults,
  markJobFailed,
} from "./workflow-runtime-client.ts";
import { emitWorkflowEvent } from "./workflow-events.ts";

// ---------------------------------------------------------------------------
// DLQ handler
// ---------------------------------------------------------------------------

export async function handleWorkflowJobDlq(
  body: unknown,
  env: WorkflowQueueEnv,
  attempts?: number,
): Promise<void> {
  if (!isValidWorkflowJobQueueMessage(body)) {
    logError(
      `CRITICAL: ${
        JSON.stringify({
          level: "CRITICAL",
          event: "WORKFLOW_DLQ_INVALID_MESSAGE",
          timestamp: new Date().toISOString(),
          message: "Invalid workflow job message format, skipping",
        })
      }`,
      undefined,
      { module: "workflow_dlq" },
    );
    return;
  }

  const { runId, jobId, repoId, jobKey } = body;
  const timestamp = new Date().toISOString();
  const db = getDb(env.DB);

  const jobRecord = await db.select({
    status: workflowJobs.status,
    name: workflowJobs.name,
  })
    .from(workflowJobs).where(eq(workflowJobs.id, jobId)).get();

  if (!jobRecord || jobRecord.status === "completed") {
    return;
  }

  // Structured DLQ entry log (matches runner DLQ pattern)
  const dlqEntry = {
    level: "CRITICAL",
    event: "WORKFLOW_JOB_DLQ_ENTRY",
    queue: "takos-workflow-jobs-dlq",
    runId,
    jobId,
    repoId,
    jobKey,
    jobName: jobRecord.name || jobKey,
    timestamp,
    retryCount: attempts ?? null,
  };
  logError(`CRITICAL: ${JSON.stringify(dlqEntry)}`, undefined, {
    module: "workflow_dlq",
  });

  await markJobFailed(env.DB, jobId, timestamp);

  // Round 11 finding #12: cancel sibling jobs and their pending steps when
  // a job enters the DLQ. Without this, sibling jobs that were queued but
  // never started keep their `queued` / `in_progress` rows forever — the
  // run is marked `failure` below, but the UI still shows "running" jobs.
  //
  // The fan-out order matters:
  //   1. sibling jobs (queued | in_progress) -> cancelled
  //   2. pending/in-progress steps belonging to *any* job of the run
  //      whose owning job is now cancelled -> cancelled
  //   3. workflow run -> failure
  //
  // Note: we explicitly exclude the DLQ'd job itself (`ne(workflowJobs.id, jobId)`)
  // because `markJobFailed()` already set its status to `completed` / `failure`
  // above; rewriting it to `cancelled` would lose the failure classification.
  try {
    await db.update(workflowJobs).set({
      status: "cancelled",
      conclusion: "cancelled",
      completedAt: timestamp,
    }).where(and(
      eq(workflowJobs.runId, runId),
      ne(workflowJobs.id, jobId),
      inArray(workflowJobs.status, ["queued", "in_progress"]),
    ));
  } catch (cancelErr) {
    logError(
      `Failed to cancel sibling jobs for DLQ'd run ${runId}`,
      cancelErr,
      { module: "workflow_dlq" },
    );
  }

  try {
    const siblingJobIds = await db.select({ id: workflowJobs.id })
      .from(workflowJobs)
      .where(and(eq(workflowJobs.runId, runId), ne(workflowJobs.id, jobId)))
      .all();
    if (siblingJobIds.length > 0) {
      await db.update(workflowSteps).set({
        status: "cancelled",
        conclusion: "cancelled",
        completedAt: timestamp,
      }).where(and(
        inArray(workflowSteps.jobId, siblingJobIds.map((row) => row.id)),
        inArray(workflowSteps.status, ["pending", "in_progress"]),
      ));
    }
  } catch (cancelStepsErr) {
    logError(
      `Failed to cancel sibling steps for DLQ'd run ${runId}`,
      cancelStepsErr,
      { module: "workflow_dlq" },
    );
  }

  // Also mark the parent workflow run as failed if it is still in progress
  try {
    await db.update(workflowRuns).set({
      status: "completed",
      conclusion: "failure",
      completedAt: timestamp,
    }).where(
      and(
        eq(workflowRuns.id, runId),
        notInArray(workflowRuns.status, ["completed", "cancelled"]),
      ),
    );
  } catch (runUpdateErr) {
    logError(`Failed to mark workflow run ${runId} as failed`, runUpdateErr, {
      module: "workflow_dlq",
    });
  }

  const bucket = env.GIT_OBJECTS;
  if (!bucket) {
    await emitWorkflowEvent(env, runId, "workflow.job.completed", {
      runId,
      jobId,
      repoId,
      jobKey,
      status: "completed",
      conclusion: "failure",
      completedAt: timestamp,
      dlq: true,
      attempts: attempts ?? null,
    });
    return;
  }

  const engine = createWorkflowEngine({
    db: env.DB,
    bucket,
    queue: env.WORKFLOW_QUEUE,
  });

  try {
    await engine.storeJobLogs(
      jobId,
      [
        "ERROR: Workflow job message reached DLQ (consumer retry exhausted).",
        `runId=${runId}`,
        `jobId=${jobId}`,
        `repoId=${repoId}`,
        `jobKey=${jobKey}`,
        `attempts=${attempts ?? "unknown"}`,
        `timestamp=${timestamp}`,
      ].join("\n"),
    );
  } catch (err) {
    logWarn(`Failed to store DLQ logs for job ${jobId}`, {
      module: "workflow_dlq",
      detail: err,
    });
  }

  const stepResults = await buildSkippedWorkflowStepResultsFromDb(
    env.DB,
    jobId,
    "dlq-failure",
    "Workflow job failed permanently (DLQ)",
  );

  try {
    await failJobWithResults(engine, jobId, stepResults, timestamp);
  } catch (err) {
    logError(`Failed to persist DLQ failure for job ${jobId}`, err, {
      module: "workflow_dlq",
    });
    throw err;
  }

  await emitWorkflowEvent(env, runId, "workflow.job.completed", {
    runId,
    jobId,
    repoId,
    jobKey,
    status: "completed",
    conclusion: "failure",
    completedAt: timestamp,
    dlq: true,
    attempts: attempts ?? null,
  });
}
