import { Hono } from 'hono';
import { z } from 'zod';
import { safeJsonParseOrDefault } from '../../../../shared/utils';
import { badRequest, parseLimit, parseOffset } from '../../shared/helpers';
import type { AuthenticatedRouteEnv } from '../../shared/helpers';
import { zValidator } from '../../zod-validator';
import { checkRepoAccess } from '../../../../application/services/source/repos';
import {
  getWorkflowRunDetail,
  getWorkflowRunJobs,
  listWorkflowRuns,
} from '../../../../application/services/workflow-runs/read-model';
import {
  cancelWorkflowRun,
  dispatchWorkflowRun,
  rerunWorkflowRun,
} from '../../../../application/services/workflow-runs/commands';
import { connectWorkflowRunStream } from '../../../../application/services/workflow-runs/stream';
import { notFound, errorResponse } from '../../../../shared/utils/error-response';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default new Hono<AuthenticatedRouteEnv>()
  .get('/repos/:repoId/actions/runs', zValidator('query', z.object({
    workflow: z.string().optional(),
    status: z.string().optional(),
    branch: z.string().optional(),
    event: z.string().optional(),
    limit: z.string().optional(),
    offset: z.string().optional(),
  })), async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const { workflow, status, branch, event, limit: limitRaw, offset: offsetRaw } = c.req.valid('query');
    const limit = parseLimit(limitRaw, 20, 100);
    const offset = parseOffset(offsetRaw);

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      return notFound(c, 'Repository');
    }

    return c.json(await listWorkflowRuns(c.env.DB, {
      repoId,
      workflow,
      status,
      branch,
      event,
      limit,
      offset,
    }));
  })
  .post('/repos/:repoId/actions/runs', zValidator('json', z.object({
    workflow: z.string(),
    ref: z.string().optional(),
    inputs: z.record(z.unknown()).optional(),
  })), async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const body = c.req.valid('json');

    if (!body.workflow) {
      return badRequest(c, 'workflow path is required');
    }

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
    if (!repoAccess) {
      return notFound(c, 'Repository');
    }

    const refName = body.ref || repoAccess.repo.default_branch || 'main';
    const result = await dispatchWorkflowRun(c.env, {
      repoId,
      workflowPath: body.workflow,
      refName,
      actorId: user.id,
      inputs: body.inputs,
    });
    if (!result.ok) {
      return c.json(
        result.details ? { error: result.error, details: result.details } : { error: result.error },
        result.status,
      );
    }
    return c.json({ run: result.run }, result.status);
  })
  .get('/repos/:repoId/actions/runs/:runId', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const runId = c.req.param('runId');
    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      return notFound(c, 'Repository');
    }

    const run = await getWorkflowRunDetail(c.env.DB, repoId, runId);
    if (!run) {
      return notFound(c, 'Run');
    }
    return c.json(run);
  })
  .get('/repos/:repoId/actions/runs/:runId/ws', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const runId = c.req.param('runId');

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      return notFound(c, 'Repository');
    }
    return connectWorkflowRunStream(c.env, {
      repoId,
      runId,
      userId: user?.id,
      request: c.req.raw,
    });
  })
  .post('/repos/:repoId/actions/runs/:runId/cancel', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const runId = c.req.param('runId');
    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
    if (!repoAccess) {
      return notFound(c, 'Repository');
    }
    const result = await cancelWorkflowRun(c.env, { repoId, runId });
    if (!result.ok) {
      return errorResponse(c, result.status, result.error);
    }
    return c.json({ cancelled: result.cancelled });
  })
  .post('/repos/:repoId/actions/runs/:runId/rerun', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const runId = c.req.param('runId');
    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
    if (!repoAccess) {
      return notFound(c, 'Repository');
    }
    const result = await rerunWorkflowRun(c.env, {
      repoId,
      runId,
      actorId: user.id,
      defaultBranch: repoAccess.repo.default_branch || 'main',
    });
    if (!result.ok) {
      return c.json(
        result.details ? { error: result.error, details: result.details } : { error: result.error },
        result.status,
      );
    }
    return c.json({ run: result.run }, result.status);
  })
  .get('/repos/:repoId/actions/runs/:runId/jobs', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const runId = c.req.param('runId');
    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      return notFound(c, 'Repository');
    }

    const jobs = await getWorkflowRunJobs(c.env.DB, repoId, runId);
    if (!jobs) {
      return notFound(c, 'Run');
    }
    return c.json(jobs);
  });
