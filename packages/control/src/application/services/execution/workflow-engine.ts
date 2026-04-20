/**
 * Workflow Execution Engine
 *
 * Orchestrates workflow runs, jobs, and steps execution using Cloudflare Queues.
 * This is the main entry-point; implementation details live in sibling modules.
 */

import type { Queue } from "../../../shared/types/bindings.ts";
import type { Conclusion } from "takos-actions-engine";
import type {
  WorkflowJobDefinition,
  WorkflowJobQueueMessage,
} from "../../../shared/types/index.ts";

// Re-export public types so existing consumers keep working.
export type {
  StartRunOptions,
  WorkflowEngineConfig,
  WorkflowJobResult,
  WorkflowRunRecord,
  WorkflowStepResult,
} from "./workflow-engine-types.ts";

import type {
  StartRunOptions,
  WorkflowEngineConfig,
  WorkflowJobResult,
  WorkflowRunRecord,
} from "./workflow-engine-types.ts";

import { cancelRun, enqueueJob, startRun } from "./workflow-run-lifecycle.ts";
import {
  onJobComplete,
  onJobStart,
  updateStepStatus,
} from "./workflow-job-scheduler.ts";
import { createArtifact, storeJobLogs } from "./workflow-storage.ts";

export interface WorkflowEngine {
  startRun(options: StartRunOptions): Promise<WorkflowRunRecord>;
  enqueueJob(options: {
    runId: string;
    jobId: string;
    repoId: string;
    ref: string;
    sha: string;
    jobKey: string;
    jobDefinition: WorkflowJobDefinition;
    env: Record<string, string>;
    secretIds: string[];
  }): Promise<void>;
  onJobComplete(jobId: string, result: WorkflowJobResult): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  onJobStart(
    jobId: string,
    runnerId?: string,
    runnerName?: string,
  ): Promise<void>;
  updateStepStatus(
    jobId: string,
    stepNumber: number,
    status: "in_progress" | "completed" | "skipped" | "cancelled",
    conclusion?: Conclusion,
    exitCode?: number,
    error?: string,
  ): Promise<void>;
  storeJobLogs(jobId: string, logs: string): Promise<string>;
  createArtifact(options: {
    runId: string;
    name: string;
    data: ArrayBuffer | Uint8Array | string;
    mimeType?: string;
    expiresInDays?: number;
  }): Promise<{ id: string; r2Key: string }>;
}

/**
 * Create a workflow engine instance
 */
export function createWorkflowEngine(
  config: WorkflowEngineConfig,
): WorkflowEngine {
  const { db, bucket, queue } = config;
  return {
    startRun: (options: StartRunOptions) =>
      startRun(db, bucket, queue, options),
    enqueueJob: (options: {
      runId: string;
      jobId: string;
      repoId: string;
      ref: string;
      sha: string;
      jobKey: string;
      jobDefinition: WorkflowJobDefinition;
      env: Record<string, string>;
      secretIds: string[];
    }) => enqueueJob(queue as Queue<WorkflowJobQueueMessage>, options),
    onJobComplete: (jobId: string, result: WorkflowJobResult) =>
      onJobComplete(db, bucket, queue, jobId, result),
    cancelRun: (runId: string) => cancelRun(db, runId),
    onJobStart: (jobId: string, runnerId?: string, runnerName?: string) =>
      onJobStart(db, jobId, runnerId, runnerName),
    updateStepStatus: (
      jobId: string,
      stepNumber: number,
      status: "in_progress" | "completed" | "skipped" | "cancelled",
      conclusion?: Conclusion,
      exitCode?: number,
      error?: string,
    ) =>
      updateStepStatus(
        db,
        jobId,
        stepNumber,
        status,
        conclusion,
        exitCode,
        error,
      ),
    storeJobLogs: (jobId: string, logs: string) =>
      storeJobLogs(db, bucket, jobId, logs),
    createArtifact: (options: {
      runId: string;
      name: string;
      data: ArrayBuffer | Uint8Array | string;
      mimeType?: string;
      expiresInDays?: number;
    }) => createArtifact(db, bucket, options),
  };
}
