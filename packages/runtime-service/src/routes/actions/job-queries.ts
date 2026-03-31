import { Hono } from 'hono';
import {
  jobManager,
  sanitizeOutputs,
} from '../../runtime/actions/job-manager.ts';
import { notFound } from 'takos-common/middleware/hono';

const app = new Hono();

// ---------------------------------------------------------------------------
// Job status & logs
// ---------------------------------------------------------------------------

app.get('/actions/jobs/:jobId/status', (c) => {
  const jobId = c.req.param('jobId');

  const job = jobManager.jobs.get(jobId);
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

  const job = jobManager.jobs.get(jobId);
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

export default app;
