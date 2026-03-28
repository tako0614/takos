import * as fs from 'fs/promises';
import { createLogger } from 'takos-common/logger';
import { pushLog } from '../logging.js';
import { type SecretsSanitizer } from './secrets.js';
import { SANDBOX_LIMITS } from '../../shared/config.js';

const logger = createLogger({ service: 'takos-runtime', defaultFields: { module: 'actions' } });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepDefinition {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  'continue-on-error'?: boolean;
  'timeout-minutes'?: number;
}

export interface ActiveJob {
  id: string;
  spaceId: string;
  repoId: string;
  ref: string;
  sha: string;
  workflowPath: string;
  jobName: string;
  workspacePath: string;
  status: 'running' | 'completed' | 'failed';
  steps: StepDefinition[];
  env: Record<string, string>;
  secrets: Record<string, string>;
  secretsSanitizer: SecretsSanitizer;
  logs: string[];
  currentStep: number;
  startedAt: number;
  completedAt?: number;
  conclusion?: 'success' | 'failure' | 'cancelled';
  outputs: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JOB_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour (reduced from 24h to catch stale jobs sooner)
const MAX_JOB_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COMPLETED_JOB_RETENTION_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Job Manager
// ---------------------------------------------------------------------------

export class JobManager {
  private activeJobs = new Map<string, ActiveJob>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupRunning = false;

  getJob(jobId: string): ActiveJob | undefined {
    return this.activeJobs.get(jobId);
  }

  hasJob(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }

  setJob(jobId: string, job: ActiveJob): void {
    this.activeJobs.set(jobId, job);
  }

  deleteJob(jobId: string): void {
    this.activeJobs.delete(jobId);
  }

  countRunningJobsForSpace(spaceId: string): number {
    return Array.from(this.activeJobs.values())
      .filter(job => job.status === 'running' && job.spaceId === spaceId)
      .length;
  }

  countRunningJobsGlobal(): number {
    return Array.from(this.activeJobs.values())
      .filter(job => job.status === 'running')
      .length;
  }

  /**
   * Check whether a new job can be started.
   * Enforces both per-space and global concurrency limits.
   */
  canStartJob(spaceId: string): { allowed: boolean; reason?: string } {
    const globalRunning = this.countRunningJobsGlobal();
    if (globalRunning >= SANDBOX_LIMITS.maxConcurrentJobs) {
      return { allowed: false, reason: `Global concurrent job limit reached (${globalRunning}/${SANDBOX_LIMITS.maxConcurrentJobs})` };
    }
    const wsRunning = this.countRunningJobsForSpace(spaceId);
    if (wsRunning >= SANDBOX_LIMITS.maxConcurrentJobs) {
      return { allowed: false, reason: `Space concurrent job limit reached (${wsRunning}/${SANDBOX_LIMITS.maxConcurrentJobs})` };
    }
    return { allowed: true };
  }

  /** Delete a job from the active map after clearing its sanitizer and cleaning up job directory. */
  async purgeJob(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job) return;
    // Delete from map first to prevent concurrent access during cleanup
    this.activeJobs.delete(jobId);
    job.secretsSanitizer.clear();
    // Ensure job directory is cleaned up (best-effort, may already be removed)
    await removeJobDirSafe(job.workspacePath, jobId, 'purged job');
  }

  /** Schedule removal of a completed job after the retention window. */
  scheduleJobCleanup(jobId: string): void {
    const tryPurge = (): void => {
      const job = this.activeJobs.get(jobId);
      if (!job) return;
      if (job.status === 'running') {
        // Still running -- retry after another retention window
        setTimeout(tryPurge, COMPLETED_JOB_RETENTION_MS);
        return;
      }
      void this.purgeJob(jobId);
    };
    setTimeout(tryPurge, COMPLETED_JOB_RETENTION_MS);
  }

  /** Mark a job failed, cleanup job directory, and schedule retention cleanup. */
  async failCloseJob(
    jobId: string,
    job: ActiveJob,
    reason: string,
  ): Promise<void> {
    job.status = 'failed';
    job.conclusion = 'failure';
    job.completedAt = Date.now();
    pushLog(job.logs, reason, job.secretsSanitizer);
    await removeJobDirSafe(job.workspacePath, jobId, 'failed job');
    this.scheduleJobCleanup(jobId);
  }

  // -- Lifecycle-managed cleanup of stale jobs --------------------------------

  startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      if (this.cleanupRunning) return;
      this.cleanupRunning = true;

      void this.cleanupStaleJobs()
        .catch((err) => {
          logger.error('Error in periodic job cleanup', { error: err });
        })
        .finally(() => {
          this.cleanupRunning = false;
        });
    }, JOB_CLEANUP_INTERVAL_MS);
  }

  stopCleanup(): void {
    if (!this.cleanupInterval) return;
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
  }

  // -- Private helpers -------------------------------------------------------

  private async cleanupStaleJobs(): Promise<void> {
    const now = Date.now();
    for (const [jobId, job] of this.activeJobs.entries()) {
      const age = now - job.startedAt;

      // Clean up jobs that exceeded maximum age regardless of status
      if (age > MAX_JOB_AGE_MS) {
        logger.info('Cleaning up stale job (max age exceeded)', { jobId, status: job.status });
        job.secretsSanitizer.clear();
        await removeJobDirSafe(job.workspacePath, jobId, 'stale job');
        this.activeJobs.delete(jobId);
        continue;
      }

      // Detect and fail running jobs that exceeded the maximum job duration
      if (job.status === 'running' && age > SANDBOX_LIMITS.maxJobDuration) {
        logger.warn('Failing job that exceeded max duration', { jobId, durationMs: age });
        await this.failCloseJob(jobId, job, `Job exceeded maximum duration of ${SANDBOX_LIMITS.maxJobDuration}ms`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers (not dependent on instance state)
// ---------------------------------------------------------------------------

/** Remove a job's working directory, logging failures instead of throwing. */
export async function removeJobDirSafe(
  workspacePath: string,
  jobId: string,
  context: string,
): Promise<void> {
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch (rmErr) {
    logger.error(`Failed to remove ${context} job directory`, { jobId, error: rmErr });
  }
}


/** Sanitize a key-value map through the job's secrets sanitizer. */
export function sanitizeOutputs(
  outputs: Record<string, string>,
  sanitizer: SecretsSanitizer,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(outputs).map(([k, v]) => [k, sanitizer.sanitize(v)])
  );
}

// ---------------------------------------------------------------------------
// Default singleton for backwards compatibility
// ---------------------------------------------------------------------------

export const jobManager = new JobManager();
