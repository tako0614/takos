import { Hono } from 'hono';
import { badRequest, notFound, parseJsonBody, requireWorkspaceAccess, type AuthenticatedRouteEnv } from '../shared/helpers';
import { createCommonEnvService } from '../../../application/services/common-env';
import { buildCommonEnvActor } from '../common-env/helpers';
import { logError } from '../../../shared/utils/logger';
import { internalError } from '../../../shared/utils/error-response';

export default new Hono<AuthenticatedRouteEnv>()
  .get('/:spaceId/common-env', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(c, spaceId, user.id);
    if (access instanceof Response) return access;

    try {
      const service = createCommonEnvService(c.env);
      const env = await service.listWorkspaceCommonEnv(access.workspace.id);
      return c.json({ env });
    } catch (error) {
      logError('Failed to load workspace common env', error, { module: 'routes/workspaces/common-env' });
      return internalError(c, 'Failed to load common env');
    }
  })
  .put('/:spaceId/common-env', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(c, spaceId, user.id, ['owner', 'admin']);
    if (access instanceof Response) return access;

    const body = await parseJsonBody<{
      name?: string;
      value?: string;
      secret?: boolean;
    }>(c);
    if (!body) {
      return badRequest(c, 'Invalid JSON body');
    }

    if (!body.name || !body.name.trim()) {
      return badRequest(c, 'name is required');
    }

    if (typeof body.value !== 'string') {
      return badRequest(c, 'value must be a string');
    }

    try {
      const service = createCommonEnvService(c.env);
      const actor = await buildCommonEnvActor(c, user.id);
      await service.upsertWorkspaceCommonEnv({
        spaceId: access.workspace.id,
        name: body.name,
        value: body.value,
        secret: body.secret === true,
        actor,
      });
      await service.reconcileWorkersForEnvKey(access.workspace.id, body.name, 'workspace_env_put');
      return c.json({ success: true });
    } catch (error) {
      logError('Failed to upsert workspace common env', error, { module: 'routes/workspaces/common-env' });
      if (error instanceof Error) {
        return badRequest(c, error.message);
      }
      return internalError(c, 'Failed to upsert common env');
    }
  })
  .delete('/:spaceId/common-env/:name', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const envName = c.req.param('name');

    const access = await requireWorkspaceAccess(c, spaceId, user.id, ['owner', 'admin']);
    if (access instanceof Response) return access;

    try {
      const service = createCommonEnvService(c.env);
      const actor = await buildCommonEnvActor(c, user.id);
      const deleted = await service.deleteWorkspaceCommonEnv(access.workspace.id, envName, actor);
      if (!deleted) {
        return notFound(c, 'Common env');
      }
      await service.reconcileWorkersForEnvKey(access.workspace.id, envName, 'workspace_env_delete');
      return c.json({ success: true });
    } catch (error) {
      logError('Failed to delete workspace common env', error, { module: 'routes/workspaces/common-env' });
      if (error instanceof Error) {
        return badRequest(c, error.message);
      }
      return internalError(c, 'Failed to delete common env');
    }
  });
