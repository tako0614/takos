import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../shared/types';
import { requireWorkspaceAccess, badRequest, notFound, internalError, type BaseVariables } from './shared/route-auth';
import { createAppDeploymentService } from '../../application/services/platform/app-deployments';
import { RolloutService } from '../../application/services/platform/rollout';
import { zValidator } from './zod-validator';
import { logError } from '../../shared/utils/logger';
import { getSpaceOperationPolicy } from '../../application/tools/tool-policy';

const createAppDeploymentSchema = z.object({
  repo_id: z.string().min(1),
  ref: z.string().min(1),
  ref_type: z.enum(['branch', 'tag', 'commit']).optional(),
  approve_oauth_auto_env: z.boolean().optional(),
  approve_source_change: z.boolean().optional(),
});

const rollbackSchema = z.object({
  approve_oauth_auto_env: z.boolean().optional(),
});

const APP_DEPLOYMENT_LIST_ROLES = getSpaceOperationPolicy('app_deployment.list').allowed_roles;
const APP_DEPLOYMENT_GET_ROLES = getSpaceOperationPolicy('app_deployment.get').allowed_roles;
const APP_DEPLOYMENT_DEPLOY_ROLES = getSpaceOperationPolicy('app_deployment.deploy_from_repo').allowed_roles;
const APP_DEPLOYMENT_ROLLBACK_ROLES = getSpaceOperationPolicy('app_deployment.rollback').allowed_roles;
const APP_DEPLOYMENT_REMOVE_ROLES = getSpaceOperationPolicy('app_deployment.remove').allowed_roles;

const routes = new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  .post('/spaces/:spaceId/app-deployments', zValidator('json', createAppDeploymentSchema), async (c) => {
    const spaceId = c.req.param('spaceId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);
    if (access instanceof Response) return access;

    try {
      const body = c.req.valid('json');
      const service = createAppDeploymentService(c.env);
      const result = await service.deployFromRepoRef(access.space.id, user.id, {
        repoId: body.repo_id,
        ref: body.ref,
        refType: body.ref_type || 'branch',
        approveOauthAutoEnv: body.approve_oauth_auto_env === true,
        approveSourceChange: body.approve_source_change === true,
      });
      return c.json({ success: true, data: result }, 201);
    } catch (error) {
      logError('App deployment create error', error, { module: 'routes/app-deployments' });
      if (error instanceof Error) return badRequest(c, error.message);
      return internalError(c, 'Failed to deploy app');
    }
  })
  .get('/spaces/:spaceId/app-deployments', async (c) => {
    const spaceId = c.req.param('spaceId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_LIST_ROLES);
    if (access instanceof Response) return access;

    try {
      const service = createAppDeploymentService(c.env);
      const deployments = await service.list(access.space.id);
      return c.json({ data: deployments });
    } catch (error) {
      logError('App deployment list error', error, { module: 'routes/app-deployments' });
      return internalError(c, 'Failed to list app deployments');
    }
  })
  .get('/spaces/:spaceId/app-deployments/:appDeploymentId', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_GET_ROLES);
    if (access instanceof Response) return access;

    try {
      const service = createAppDeploymentService(c.env);
      const deployment = await service.get(access.space.id, appDeploymentId);
      if (!deployment) return notFound(c, 'App deployment');
      return c.json({ data: deployment });
    } catch (error) {
      logError('App deployment get error', error, { module: 'routes/app-deployments' });
      return internalError(c, 'Failed to get app deployment');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollback', zValidator('json', rollbackSchema), async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_ROLLBACK_ROLES);
    if (access instanceof Response) return access;

    try {
      const body = c.req.valid('json');
      const service = createAppDeploymentService(c.env);
      const result = await service.rollback(access.space.id, user.id, appDeploymentId, {
        approveOauthAutoEnv: body.approve_oauth_auto_env === true,
      });
      return c.json({ success: true, data: result });
    } catch (error) {
      logError('App deployment rollback error', error, { module: 'routes/app-deployments' });
      if (error instanceof Error) return badRequest(c, error.message);
      return internalError(c, 'Failed to rollback app deployment');
    }
  })
  .get('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_GET_ROLES);
    if (access instanceof Response) return access;

    try {
      const rollout = new RolloutService(c.env);
      const state = await rollout.getRolloutState(appDeploymentId);
      return c.json({ data: state });
    } catch (error) {
      logError('Rollout get error', error, { module: 'routes/app-deployments' });
      return internalError(c, 'Failed to get rollout state');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/pause', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);
    if (access instanceof Response) return access;

    try {
      const rollout = new RolloutService(c.env);
      const deployment = await createAppDeploymentService(c.env).get(access.space.id, appDeploymentId);
      if (!deployment) return notFound(c, 'App deployment');
      const hostname = deployment.hostnames?.[0] || '';
      const state = await rollout.pauseRollout(appDeploymentId, hostname);
      return c.json({ success: true, data: state });
    } catch (error) {
      logError('Rollout pause error', error, { module: 'routes/app-deployments' });
      if (error instanceof Error) return badRequest(c, error.message);
      return internalError(c, 'Failed to pause rollout');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/resume', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);
    if (access instanceof Response) return access;

    try {
      const rollout = new RolloutService(c.env);
      const deployment = await createAppDeploymentService(c.env).get(access.space.id, appDeploymentId);
      if (!deployment) return notFound(c, 'App deployment');
      const hostname = deployment.hostnames?.[0] || '';
      const state = await rollout.resumeRollout(appDeploymentId, hostname);
      return c.json({ success: true, data: state });
    } catch (error) {
      logError('Rollout resume error', error, { module: 'routes/app-deployments' });
      if (error instanceof Error) return badRequest(c, error.message);
      return internalError(c, 'Failed to resume rollout');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/abort', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);
    if (access instanceof Response) return access;

    try {
      const rollout = new RolloutService(c.env);
      const deployment = await createAppDeploymentService(c.env).get(access.space.id, appDeploymentId);
      if (!deployment) return notFound(c, 'App deployment');
      const hostname = deployment.hostnames?.[0] || '';
      const state = await rollout.abortRollout(appDeploymentId, hostname);
      return c.json({ success: true, data: state });
    } catch (error) {
      logError('Rollout abort error', error, { module: 'routes/app-deployments' });
      if (error instanceof Error) return badRequest(c, error.message);
      return internalError(c, 'Failed to abort rollout');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/promote', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);
    if (access instanceof Response) return access;

    try {
      const rollout = new RolloutService(c.env);
      const deployment = await createAppDeploymentService(c.env).get(access.space.id, appDeploymentId);
      if (!deployment) return notFound(c, 'App deployment');
      const hostname = deployment.hostnames?.[0] || '';
      const state = await rollout.promoteRollout(appDeploymentId, hostname);
      return c.json({ success: true, data: state });
    } catch (error) {
      logError('Rollout promote error', error, { module: 'routes/app-deployments' });
      if (error instanceof Error) return badRequest(c, error.message);
      return internalError(c, 'Failed to promote rollout');
    }
  })
  .delete('/spaces/:spaceId/app-deployments/:appDeploymentId', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_REMOVE_ROLES);
    if (access instanceof Response) return access;

    try {
      const service = createAppDeploymentService(c.env);
      const deployment = await service.get(access.space.id, appDeploymentId);
      if (!deployment) return notFound(c, 'App deployment');
      await service.remove(access.space.id, appDeploymentId);
      return c.json({ success: true });
    } catch (error) {
      logError('App deployment delete error', error, { module: 'routes/app-deployments' });
      return internalError(c, 'Failed to remove app deployment');
    }
  });

export default routes;
