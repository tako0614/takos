import { Hono } from 'hono';
import { parseJsonBody, spaceAccess, type SpaceAccessRouteEnv } from '../shared/route-auth';
import { createCommonEnvService } from '../../../application/services/common-env';
import { buildCommonEnvActor } from '../common-env/handlers';
import { logError } from '../../../shared/utils/logger';
import { AppError, BadRequestError, NotFoundError, InternalError } from 'takos-common/errors';

export default new Hono<SpaceAccessRouteEnv>()
  .get('/:spaceId/common-env', spaceAccess(), async (c) => {
    const { space } = c.get('access');

    try {
      const service = createCommonEnvService(c.env);
      const env = await service.listSpaceCommonEnv(space.id);
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
      const service = createCommonEnvService(c.env);
      const actor = await buildCommonEnvActor(c, user.id);
      await service.upsertSpaceCommonEnv({
        spaceId: space.id,
        name: body.name,
        value: body.value,
        secret: body.secret === true,
        actor,
      });
      await service.reconcileWorkersForEnvKey(space.id, body.name, 'workspace_env_put');
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
      const service = createCommonEnvService(c.env);
      const actor = await buildCommonEnvActor(c, user.id);
      const deleted = await service.deleteSpaceCommonEnv(space.id, envName, actor);
      if (!deleted) {
        throw new NotFoundError('Common env');
      }
      await service.reconcileWorkersForEnvKey(space.id, envName, 'workspace_env_delete');
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
