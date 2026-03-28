import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../shared/types';
import { requireSpaceAccess, type BaseVariables } from './shared/route-auth';
import { NotFoundError, InternalError, isAppError } from '@takoserver/common/errors';
import { createAppDeploymentService } from '../../application/services/platform/app-deployments';
import { RolloutService } from '../../application/services/platform/rollout';
import { zValidator } from './zod-validator';
import { logError } from '../../shared/utils/logger';
import { getSpaceOperationPolicy } from '../../application/tools/tool-policy';

function handleRouteError(error: unknown, context: string): never {
  if (isAppError(error)) throw error;
  logError(`${context} error`, error, { module: 'routes/app-deployments' });
  throw new InternalError(`Failed to ${context}`);
}

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
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);

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
      handleRouteError(error, 'deploy app');
    }
  })
  .get('/spaces/:spaceId/app-deployments', async (c) => {
    const spaceId = c.req.param('spaceId');
    const user = c.get('user');
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_LIST_ROLES);

    try {
      const service = createAppDeploymentService(c.env);
      const deployments = await service.list(access.space.id);
      return c.json({ data: deployments });
    } catch (error) {
      handleRouteError(error, 'list app deployments');
    }
  })
  .get('/spaces/:spaceId/app-deployments/:appDeploymentId', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_GET_ROLES);

    try {
      const service = createAppDeploymentService(c.env);
      const deployment = await service.get(access.space.id, appDeploymentId);
      if (!deployment) throw new NotFoundError('App deployment');
      return c.json({ data: deployment });
    } catch (error) {
      handleRouteError(error, 'get app deployment');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollback', zValidator('json', rollbackSchema), async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_ROLLBACK_ROLES);

    try {
      const body = c.req.valid('json');
      const service = createAppDeploymentService(c.env);
      const result = await service.rollback(access.space.id, user.id, appDeploymentId, {
        approveOauthAutoEnv: body.approve_oauth_auto_env === true,
      });
      return c.json({ success: true, data: result });
    } catch (error) {
      handleRouteError(error, 'rollback app deployment');
    }
  })
  .get('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_GET_ROLES);

    try {
      const rollout = new RolloutService(c.env);
      const state = await rollout.getRolloutState(appDeploymentId);
      return c.json({ data: state });
    } catch (error) {
      handleRouteError(error, 'get rollout state');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/pause', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);

    try {
      const rollout = new RolloutService(c.env);
      const deployment = await createAppDeploymentService(c.env).get(access.space.id, appDeploymentId);
      if (!deployment) throw new NotFoundError('App deployment');
      const hostname = deployment.hostnames?.[0] || '';
      const state = await rollout.pauseRollout(appDeploymentId, hostname);
      return c.json({ success: true, data: state });
    } catch (error) {
      handleRouteError(error, 'pause rollout');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/resume', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);

    try {
      const rollout = new RolloutService(c.env);
      const deployment = await createAppDeploymentService(c.env).get(access.space.id, appDeploymentId);
      if (!deployment) throw new NotFoundError('App deployment');
      const hostname = deployment.hostnames?.[0] || '';
      const state = await rollout.resumeRollout(appDeploymentId, hostname);
      return c.json({ success: true, data: state });
    } catch (error) {
      handleRouteError(error, 'resume rollout');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/abort', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);

    try {
      const rollout = new RolloutService(c.env);
      const deployment = await createAppDeploymentService(c.env).get(access.space.id, appDeploymentId);
      if (!deployment) throw new NotFoundError('App deployment');
      const hostname = deployment.hostnames?.[0] || '';
      const state = await rollout.abortRollout(appDeploymentId, hostname);
      return c.json({ success: true, data: state });
    } catch (error) {
      handleRouteError(error, 'abort rollout');
    }
  })
  .post('/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/promote', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_DEPLOY_ROLES);

    try {
      const rollout = new RolloutService(c.env);
      const deployment = await createAppDeploymentService(c.env).get(access.space.id, appDeploymentId);
      if (!deployment) throw new NotFoundError('App deployment');
      const hostname = deployment.hostnames?.[0] || '';
      const state = await rollout.promoteRollout(appDeploymentId, hostname);
      return c.json({ success: true, data: state });
    } catch (error) {
      handleRouteError(error, 'promote rollout');
    }
  })
  .delete('/spaces/:spaceId/app-deployments/:appDeploymentId', async (c) => {
    const spaceId = c.req.param('spaceId');
    const appDeploymentId = c.req.param('appDeploymentId');
    const user = c.get('user');
    const access = await requireSpaceAccess(c, spaceId, user.id, APP_DEPLOYMENT_REMOVE_ROLES);

    try {
      const service = createAppDeploymentService(c.env);
      const deployment = await service.get(access.space.id, appDeploymentId);
      if (!deployment) throw new NotFoundError('App deployment');
      await service.remove(access.space.id, appDeploymentId);
      return c.json({ success: true });
    } catch (error) {
      handleRouteError(error, 'remove app deployment');
    }
  });

export default routes;
