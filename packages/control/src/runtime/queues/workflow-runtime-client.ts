import type { D1Database } from "../../shared/types/bindings.ts";
import type { Step } from "takos-actions-engine";
import type {
  WorkflowEngine,
  WorkflowStepResult,
} from "../../application/services/execution/workflow-engine.ts";
import {
  getDb,
  repositories,
  workflowJobs,
  workflowRuns,
  workflowSteps,
} from "../../infra/db/index.ts";
import { and, asc, eq, ne } from "drizzle-orm";
import { safeJsonParseOrDefault } from "../../shared/utils/index.ts";
import { callRuntimeRequest } from "../../application/services/execution/runtime-request-handler.ts";
import { logWarn } from "../../shared/utils/logger.ts";
import type { RunContext, WorkflowQueueEnv } from "./workflow-types.ts";

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

export async function runtimeJson<T>(
  env: WorkflowQueueEnv,
  endpoint: string,
  spaceId: string,
  body?: Record<string, unknown>,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "POST",
): Promise<T> {
  const requestBody = {
    ...(body || {}),
    space_id: spaceId,
  };
  const response = await callRuntimeRequest(env, endpoint, {
    method,
    body: requestBody,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Runtime request failed (${response.status}): ${
        errorText || response.statusText
      }`,
    );
  }
  return response.json() as Promise<T>;
}

export async function runtimeDelete(
  env: WorkflowQueueEnv,
  endpoint: string,
  spaceId: string,
): Promise<void> {
  try {
    const response = await callRuntimeRequest(env, endpoint, {
      method: "DELETE",
      body: { space_id: spaceId },
    });
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      throw new Error(
        `Runtime delete failed (${response.status}): ${
          errorText || response.statusText
        }`,
      );
    }
  } catch (err) {
    logWarn(`Failed to delete runtime job (${endpoint})`, {
      module: "queues/workflow-jobs",
      detail: err,
    });
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export async function getRunContext(
  d1: D1Database,
  runId: string,
): Promise<RunContext> {
  const db = getDb(d1);
  const run = await db.select({
    workflowPath: workflowRuns.workflowPath,
    inputs: workflowRuns.inputs,
  })
    .from(workflowRuns).where(eq(workflowRuns.id, runId)).get();

  return {
    workflowPath: run?.workflowPath || "unknown",
    inputs: safeJsonParseOrDefault<Record<string, unknown>>(run?.inputs, {}),
  };
}

export function getStepDisplayName(step: Step, stepNumber: number): string {
  return step.name || step.uses || step.run?.slice(0, 50) ||
    `Step ${stepNumber}`;
}

export async function getRunStatus(
  d1: D1Database,
  runId: string,
): Promise<string | null> {
  const db = getDb(d1);
  const run = await db.select({ status: workflowRuns.status })
    .from(workflowRuns).where(eq(workflowRuns.id, runId)).get();
  return run?.status ?? null;
}

export async function getSpaceIdFromRepoId(
  d1: D1Database,
  repoId: string,
): Promise<string> {
  const db = getDb(d1);
  const repository = await db.select({ accountId: repositories.accountId })
    .from(repositories).where(eq(repositories.id, repoId)).get();

  if (!repository?.accountId) {
    throw new Error(`Space not found for repository ${repoId}`);
  }

  return repository.accountId;
}

export async function markJobSkipped(
  d1: D1Database,
  jobId: string,
  timestamp: string,
  conclusion: "skipped" | "cancelled" = "skipped",
): Promise<void> {
  const db = getDb(d1);
  const status = conclusion === "cancelled" ? "cancelled" : "completed";
  await db.update(workflowJobs).set({
    status,
    conclusion,
    completedAt: timestamp,
  }).where(and(
    eq(workflowJobs.id, jobId),
    ne(workflowJobs.status, "completed"),
    ne(workflowJobs.status, "cancelled"),
  ));
  await db.update(workflowSteps).set({
    status: conclusion === "cancelled" ? "cancelled" : "skipped",
    conclusion,
    completedAt: timestamp,
  }).where(eq(workflowSteps.jobId, jobId));
}

// ---------------------------------------------------------------------------
// Shared step-result builders
// ---------------------------------------------------------------------------

/** Build skipped WorkflowStepResult entries from existing DB step records. */
export async function buildSkippedWorkflowStepResultsFromDb(
  d1: D1Database,
  jobId: string,
  fallbackName: string,
  errorMessage?: string,
): Promise<WorkflowStepResult[]> {
  const db = getDb(d1);
  const steps = await db.select({
    number: workflowSteps.number,
    name: workflowSteps.name,
  })
    .from(workflowSteps).where(eq(workflowSteps.jobId, jobId))
    .orderBy(asc(workflowSteps.number)).all();

  if (steps.length > 0) {
    return steps.map((s, idx) => ({
      stepNumber: s.number,
      name: s.name,
      status: "skipped" as const,
      conclusion: "skipped" as const,
      error: idx === 0 ? errorMessage : undefined,
      outputs: {},
    }));
  }

  return [
    {
      stepNumber: 1,
      name: fallbackName,
      status: "skipped" as const,
      conclusion: "skipped" as const,
      error: errorMessage,
      outputs: {},
    },
  ];
}

/** Mark a job as failed and record step results via onJobComplete. */
export async function failJobWithResults(
  engine: WorkflowEngine,
  jobId: string,
  stepResults: WorkflowStepResult[],
  timestamp: string,
): Promise<void> {
  await engine.onJobComplete(jobId, {
    jobId,
    status: "completed",
    conclusion: "failure",
    outputs: {},
    stepResults,
    startedAt: timestamp,
    completedAt: timestamp,
  });
}

/** Mark a job record as failed in the DB (idempotent via status guard). */
export async function markJobFailed(
  d1: D1Database,
  jobId: string,
  timestamp: string,
): Promise<void> {
  const db = getDb(d1);
  await db.update(workflowJobs).set({
    status: "completed",
    conclusion: "failure",
    completedAt: timestamp,
  }).where(
    and(eq(workflowJobs.id, jobId), ne(workflowJobs.status, "completed")),
  );
}
