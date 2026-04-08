import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticatedRouteEnv } from '../../route-auth.ts';
import { parsePagination } from '../../../../shared/utils/index.ts';
import { BadRequestError, ErrorCodes } from 'takos-common/errors';
import { zValidator } from '../../zod-validator.ts';
import { checkRepoAccess } from '../../../../application/services/source/repos.ts';
import {
  getWorkflowRunDetail,
  getWorkflowRunJobs,
  listWorkflowRuns,
} from '../../../../application/services/workflow-runs/read-model.ts';
import {
  cancelWorkflowRun,
  dispatchWorkflowRun,
  rerunWorkflowRun,
} from '../../../../application/services/workflow-runs/commands.ts';
import { connectWorkflowRunStream } from '../../../../application/services/workflow-runs/stream.ts';
import { NotFoundError, AppError } from 'takos-common/errors';

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
    const { limit, offset } = parsePagination({ limit: limitRaw, offset: offsetRaw });

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      throw new NotFoundError('Repository');
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
      throw new BadRequestError( 'workflow path is required');
    }

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
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
      // Match the documented common error envelope
      // (docs/reference/api.md "エラーレスポンスの共通形式").
      throw new AppError(
        result.error,
        result.status === 404 ? ErrorCodes.NOT_FOUND
          : result.status === 500 ? ErrorCodes.INTERNAL_ERROR
          : ErrorCodes.BAD_REQUEST,
        result.status,
        result.details ? { details: result.details } : undefined,
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
      throw new NotFoundError('Repository');
    }

    const run = await getWorkflowRunDetail(c.env.DB, repoId, runId);
    if (!run) {
      throw new NotFoundError('Run');
    }
    return c.json(run);
  })
  .get('/repos/:repoId/actions/runs/:runId/ws', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const runId = c.req.param('runId');

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      throw new NotFoundError('Repository');
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
      throw new NotFoundError('Repository');
    }
    const result = await cancelWorkflowRun(c.env, { repoId, runId });
    if (!result.ok) {
      throw new AppError(
        result.error,
        result.status === 404 ? ErrorCodes.NOT_FOUND : ErrorCodes.BAD_REQUEST,
        result.status,
      );
    }
    return c.json({ cancelled: result.cancelled });
  })
  .post('/repos/:repoId/actions/runs/:runId/rerun', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const runId = c.req.param('runId');
    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }
    const result = await rerunWorkflowRun(c.env, {
      repoId,
      runId,
      actorId: user.id,
      defaultBranch: repoAccess.repo.default_branch || 'main',
    });
    if (!result.ok) {
      throw new AppError(
        result.error,
        result.status === 404 ? ErrorCodes.NOT_FOUND
          : result.status === 500 ? ErrorCodes.INTERNAL_ERROR
          : ErrorCodes.BAD_REQUEST,
        result.status,
        result.details ? { details: result.details } : undefined,
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
      throw new NotFoundError('Repository');
    }

    const jobs = await getWorkflowRunJobs(c.env.DB, repoId, runId);
    if (!jobs) {
      throw new NotFoundError('Run');
    }
    return c.json(jobs);
  });
