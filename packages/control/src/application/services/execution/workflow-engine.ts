/**
 * Workflow Execution Engine
 *
 * Orchestrates workflow runs, jobs, and steps execution using Cloudflare Queues.
 * This is the main entry-point; implementation details live in sibling modules.
 */

import type { Queue } from '../../../shared/types/bindings.ts';
import type { Conclusion } from '@takos/actions-engine';
import type { WorkflowJobDefinition, WorkflowJobQueueMessage } from '../../../shared/types';

// Re-export public types so existing consumers keep working.
export type {
  WorkflowEngineConfig,
  StartRunOptions,
  JobResult,
  StepResult,
  WorkflowRunRecord,
} from './workflow-engine-types';

import type {
  WorkflowEngineConfig,
  StartRunOptions,
  WorkflowRunRecord,
  WorkflowBucket,
  JobResult,
} from './workflow-engine-types';

import { startRun, cancelRun, enqueueJob } from './workflow-run-lifecycle';
import { onJobComplete, onJobStart, updateStepStatus } from './workflow-job-scheduler';
import { storeJobLogs, createArtifact } from './workflow-storage';

import type { D1Database } from '../../../shared/types/bindings.ts';

export class WorkflowEngine {
  private db: D1Database;
  private bucket: WorkflowBucket;
  private queue?: Queue<WorkflowJobQueueMessage>;

  constructor(config: WorkflowEngineConfig) {
    this.db = config.db;
    this.bucket = config.bucket;
    this.queue = config.queue;
  }

  /**
   * Start a new workflow run
   */
  async startRun(options: StartRunOptions): Promise<WorkflowRunRecord> {
    return startRun(this.db, this.bucket, this.queue, options);
  }

  /**
   * Enqueue a job for execution
   */
  async enqueueJob(options: {
    runId: string;
    jobId: string;
    repoId: string;
    ref: string;
    sha: string;
    jobKey: string;
    jobDefinition: WorkflowJobDefinition;
    env: Record<string, string>;
    secretIds: string[];
  }): Promise<void> {
    return enqueueJob(this.queue, options);
  }

  /**
   * Handle job completion
   */
  async onJobComplete(jobId: string, result: JobResult): Promise<void> {
    return onJobComplete(this.db, this.bucket, this.queue, jobId, result);
  }

  /**
   * Cancel a running workflow
   */
  async cancelRun(runId: string): Promise<void> {
    return cancelRun(this.db, runId);
  }

  /**
   * Update job status when it starts running
   */
  async onJobStart(jobId: string, runnerId?: string, runnerName?: string): Promise<void> {
    return onJobStart(this.db, jobId, runnerId, runnerName);
  }

  /**
   * Update step status
   */
  async updateStepStatus(
    jobId: string,
    stepNumber: number,
    status: 'in_progress' | 'completed' | 'skipped',
    conclusion?: Conclusion,
    exitCode?: number,
    error?: string,
  ): Promise<void> {
    return updateStepStatus(this.db, jobId, stepNumber, status, conclusion, exitCode, error);
  }

  /**
   * Store job logs in R2
   */
  async storeJobLogs(jobId: string, logs: string): Promise<string> {
    return storeJobLogs(this.db, this.bucket, jobId, logs);
  }

  /**
   * Create an artifact for a run
   */
  async createArtifact(options: {
    runId: string;
    name: string;
    data: ArrayBuffer | Uint8Array | string;
    mimeType?: string;
    expiresInDays?: number;
  }): Promise<{ id: string; r2Key: string }> {
    return createArtifact(this.db, this.bucket, options);
  }
}

/**
 * Create a workflow engine instance
 */
export function createWorkflowEngine(config: WorkflowEngineConfig): WorkflowEngine {
  return new WorkflowEngine(config);
}
