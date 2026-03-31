import { Hono } from 'hono';
import { parseJsonBody, spaceAccess, type SpaceAccessRouteEnv } from '../route-auth.ts';
import { createCommonEnvDeps, listSpaceCommonEnv, upsertSpaceCommonEnv, deleteSpaceCommonEnv } from '../../../application/services/common-env/index.ts';
import { buildCommonEnvActor } from '../common-env-handlers.ts';
import { logError } from '../../../shared/utils/logger.ts';
import { AppError, BadRequestError, NotFoundError, InternalError } from 'takos-common/errors';

export default new Hono<SpaceAccessRouteEnv>()
  .get('/:spaceId/common-env', spaceAccess(), async (c) => {
    const { space } = c.get('access');

    try {
      const deps = createCommonEnvDeps(c.env);
      const env = await listSpaceCommonEnv(deps.spaceEnv, space.id);
      return c.json({ env });
    } catch (error) {
      logError('Failed to load space common env', error, { module: 'routes/spaces/common-env' });
      throw new InternalError('Failed to load common env');
    }
  })
  .put('/:spaceId/common-env', spaceAccess({ roles: ['owner', 'admin'] }), async (c) => {
    const user = c.get('user');
    const { space } = c.get('access');

    const body = await parseJsonBody<{
      name?: string;
      value?: string;
      secret?: boolean;
    }>(c);
    if (!body) {
      throw new BadRequestError('Invalid JSON body');
    }

    if (!body.name || !body.name.trim()) {
      throw new BadRequestError('name is required');
    }

    if (typeof body.value !== 'string') {
      throw new BadRequestError('value must be a string');
    }

    try {
      const deps = createCommonEnvDeps(c.env);
      const actor = await buildCommonEnvActor(c, user.id);
      await upsertSpaceCommonEnv(deps.spaceEnv, {
        spaceId: space.id,
        name: body.name,
        value: body.value,
        secret: body.secret === true,
        actor,
      });
      await deps.orchestrator.reconcileServicesForEnvKey(space.id, body.name, 'workspace_env_put');
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logError('Failed to upsert space common env', error, { module: 'routes/spaces/common-env' });
      if (error instanceof Error) {
        throw new BadRequestError(error.message);
      }
      throw new InternalError('Failed to upsert common env');
    }
  })
  .delete('/:spaceId/common-env/:name', spaceAccess({ roles: ['owner', 'admin'] }), async (c) => {
    const user = c.get('user');
    const { space } = c.get('access');
    const envName = c.req.param('name');

    try {
      const deps = createCommonEnvDeps(c.env);
      const actor = await buildCommonEnvActor(c, user.id);
      const deleted = await deleteSpaceCommonEnv(deps.spaceEnv, space.id, envName, actor);
      if (!deleted) {
        throw new NotFoundError('Common env');
      }
      await deps.orchestrator.reconcileServicesForEnvKey(space.id, envName, 'workspace_env_delete');
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logError('Failed to delete space common env', error, { module: 'routes/spaces/common-env' });
      if (error instanceof Error) {
        throw new BadRequestError(error.message);
      }
      throw new InternalError('Failed to delete common env');
    }
  });
