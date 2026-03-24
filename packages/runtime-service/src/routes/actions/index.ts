import { Hono } from 'hono';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SANDBOX_LIMITS } from '../../shared/config.js';
import { createSandboxEnv } from '../../utils/env-filter.js';
import { createSecretsSanitizer } from '../../runtime/actions/secrets.js';
import { pushLog } from '../../runtime/logging.js';
import { isR2Configured, s3Client } from '../../storage/r2.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { R2_BUCKET } from '../../shared/config.js';
import {
  getScopedWorkspaceId,
  hasWorkspaceScopeMismatch,
  WORKSPACE_SCOPE_MISMATCH_ERROR,
} from '../../middleware/workspace-scope.js';
import {
  jobManager,
  removeWorkspaceSafe,
  sanitizeOutputs,
  type ActiveJob,
} from '../../runtime/actions/job-manager.js';
import { collectSensitiveEnvValues } from '../../runtime/actions/secrets.js';

interface StartJobRequest {
  space_id?: string;
  repoId: string;
  ref: string;
  sha: string;
  workflowPath: string;
  jobName: string;
  steps: Array<{
    name?: string;
    run?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
    if?: string;
    'continue-on-error'?: boolean;
    'timeout-minutes'?: number;
  }>;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
}
import { badRequest, forbidden, internalError, notFound } from '@takos/common/middleware/hono';
import { ErrorCodes } from '@takos/common/errors';
import executionRoutes from './execution.js';

const app = new Hono();

// Mount execution routes (checkout + step)
app.route('/', executionRoutes);

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

app.post('/actions/jobs/:jobId/start', async (c) => {
  const jobId = c.req.param('jobId');
  const body = await c.req.json() as StartJobRequest | undefined;

  try {
    if (body?.space_id !== undefined) {
      if (typeof body.space_id !== 'string' || body.space_id.length === 0) {
        return badRequest(c, 'space_id must be a non-empty string when provided');
      }
    }

    const scopedWorkspaceId = getScopedWorkspaceId(c);
    if (scopedWorkspaceId && !body?.space_id) {
      return badRequest(c, 'space_id is required for workspace-scoped token');
    }
    if (hasWorkspaceScopeMismatch(c, body?.space_id)) {
      return forbidden(c, WORKSPACE_SCOPE_MISMATCH_ERROR);
    }

    if (!body || !body.repoId || !body.ref || !body.sha) {
      return badRequest(c, 'Missing required fields: repoId, ref, sha');
    }

    if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
      return badRequest(c, 'Missing or invalid steps array');
    }
    if (body.steps.length > SANDBOX_LIMITS.maxStepsPerJob) {
      return badRequest(c, `Steps exceed per-job limit (max ${SANDBOX_LIMITS.maxStepsPerJob})`);
    }

    if (jobManager.hasJob(jobId)) {
      return c.json({ error: { code: ErrorCodes.CONFLICT, message: 'Job already exists' } }, 409);
    }

    const jobWorkspaceId = body.space_id ?? scopedWorkspaceId ?? '__unspecified_workspace__';

    const runningJobs = jobManager.countRunningJobsForWorkspace(jobWorkspaceId);
    if (runningJobs >= SANDBOX_LIMITS.maxConcurrentJobs) {
      return c.json({ error: { code: ErrorCodes.RATE_LIMITED, message: `Concurrent job limit reached (max ${SANDBOX_LIMITS.maxConcurrentJobs})` } }, 429);
    }

    const workspacePath = path.join(
      os.tmpdir(),
      `takos-actions-${jobId.slice(0, 8)}-${Date.now()}`
    );
    await fs.mkdir(workspacePath, { recursive: true });

    const logs: string[] = [];
    pushLog(logs, `Starting job: ${body.jobName || jobId}`);
    pushLog(logs, `Repository: ${body.repoId}`);
    pushLog(logs, `Ref: ${body.ref} (${body.sha})`);

    const baseEnv = createSandboxEnv({
      ...body.env,
      GITHUB_ACTIONS: 'true',
      CI: 'true',
      GITHUB_WORKSPACE: workspacePath,
      GITHUB_REPOSITORY: body.repoId,
      GITHUB_REF: body.ref,
      GITHUB_SHA: body.sha,
      GITHUB_JOB: body.jobName || jobId,
      GITHUB_RUN_ID: jobId,
      GITHUB_WORKFLOW: body.workflowPath,
    }, SANDBOX_LIMITS.maxEnvValueLength);

    const secretsSanitizer = createSecretsSanitizer(
      body.secrets || {},
      collectSensitiveEnvValues(body.env)
    );

    const job: ActiveJob = {
      id: jobId,
      spaceId: jobWorkspaceId,
      repoId: body.repoId,
      ref: body.ref,
      sha: body.sha,
      workflowPath: body.workflowPath,
      jobName: body.jobName || jobId,
      workspacePath,
      status: 'running',
      steps: body.steps,
      env: baseEnv,
      secrets: body.secrets || {},
      secretsSanitizer,
      logs,
      currentStep: 0,
      startedAt: Date.now(),
      outputs: {},
    };

    jobManager.setJob(jobId, job);

    pushLog(logs, 'Job workspace created successfully');
    pushLog(logs, `Workspace path: ${workspacePath}`);

    return c.json({
      jobId,
      status: 'running',
      workspacePath,
      message: 'Job started successfully',
    });
  } catch (err) {
    c.get('log')?.error('Error starting job', { jobId, error: err });
    return internalError(c, 'Failed to start job');
  }
});

app.post('/actions/jobs/:jobId/complete', async (c) => {
  const jobId = c.req.param('jobId');
  const { conclusion, uploadLogs } = await c.req.json() as {
    conclusion?: 'success' | 'failure' | 'cancelled';
    uploadLogs?: boolean;
  };

  try {
    const job = jobManager.getJob(jobId);
    if (!job) return notFound(c, 'Job not found');

    job.status = conclusion === 'success' ? 'completed' : 'failed';
    job.conclusion = conclusion || 'success';
    job.completedAt = Date.now();

    pushLog(job.logs, `\n=== Job ${job.conclusion} ===`, job.secretsSanitizer);
    pushLog(job.logs, `Duration: ${(job.completedAt - job.startedAt) / 1000}s`, job.secretsSanitizer);

    let logsUrl: string | undefined;
    if (uploadLogs && isR2Configured()) {
      try {
        const logsKey = `actions/jobs/${jobId}/logs.txt`;
        const sanitizedLogs = job.secretsSanitizer.sanitizeLogs(job.logs);
        await s3Client.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: logsKey,
            Body: sanitizedLogs.join('\n'),
            ContentType: 'text/plain',
            Metadata: {
              'job-id': jobId,
              'conclusion': job.conclusion,
              'completed-at': new Date(job.completedAt).toISOString(),
            },
          })
        );
        logsUrl = logsKey;
        pushLog(job.logs, `Logs uploaded to R2: ${logsKey}`, job.secretsSanitizer);
      } catch (uploadErr) {
        c.get('log')?.error('Failed to upload logs', { jobId, error: uploadErr });
      }
    }

    try {
      await fs.rm(job.workspacePath, { recursive: true, force: true });
      pushLog(job.logs, 'Workspace cleaned up', job.secretsSanitizer);
    } catch {
      c.get('log')?.warn('Failed to cleanup workspace', { jobId });
    }

    const response = {
      jobId,
      status: job.status,
      conclusion: job.conclusion,
      duration: (job.completedAt - job.startedAt) / 1000,
      outputs: job.outputs,
      logsUrl,
    };

    jobManager.scheduleJobCleanup(jobId);

    return c.json(response);
  } catch (err) {
    c.get('log')?.error('Error completing job', { jobId, error: err });
    return internalError(c, 'Failed to complete job');
  }
});

// ---------------------------------------------------------------------------
// Job status & logs
// ---------------------------------------------------------------------------

app.get('/actions/jobs/:jobId/status', (c) => {
  const jobId = c.req.param('jobId');

  const job = jobManager.getJob(jobId);
  if (!job) return notFound(c, 'Job not found');

  return c.json({
    jobId,
    status: job.status,
    conclusion: job.conclusion,
    currentStep: job.currentStep,
    totalSteps: job.steps.length,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    outputs: sanitizeOutputs(job.outputs, job.secretsSanitizer),
  });
});

app.get('/actions/jobs/:jobId/logs', (c) => {
  const jobId = c.req.param('jobId');
  const offset = c.req.query('offset');

  const job = jobManager.getJob(jobId);
  if (!job) return notFound(c, 'Job not found');

  const rawOffset = offset ? parseInt(offset, 10) : 0;
  const startOffset = Number.isFinite(rawOffset) ? rawOffset : 0;
  const rawLogs = job.logs.slice(startOffset);
  const logs = job.secretsSanitizer.sanitizeLogs(rawLogs);

  return c.json({
    logs,
    offset: startOffset,
    total: job.logs.length,
    hasMore: startOffset + logs.length < job.logs.length,
  });
});

// ---------------------------------------------------------------------------
// Job cancellation
// ---------------------------------------------------------------------------

app.delete('/actions/jobs/:jobId', async (c) => {
  const jobId = c.req.param('jobId');

  try {
    const job = jobManager.getJob(jobId);
    if (!job) return notFound(c, 'Job not found');

    job.status = 'failed';
    job.conclusion = 'cancelled';
    job.completedAt = Date.now();

    pushLog(job.logs, '\n=== Job cancelled ===', job.secretsSanitizer);

    job.secretsSanitizer.clear();

    await removeWorkspaceSafe(job.workspacePath, jobId, 'cancelled job');

    jobManager.deleteJob(jobId);

    return c.json({
      jobId,
      status: 'cancelled',
      message: 'Job cancelled and cleaned up',
    });
  } catch (err) {
    c.get('log')?.error('Error cancelling job', { jobId, error: err });
    return internalError(c, 'Failed to cancel job');
  }
});

export default app;
