import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { BadRequestError } from 'takos-common/errors';
import { zValidator } from '../zod-validator';
import { getServiceForUser, getServiceForUserWithRole } from '../../../application/services/platform/workers';
import { createCommonEnvService } from '../../../application/services/common-env';
import { buildCommonEnvActor } from '../common-env/handlers';
import { normalizeCommonEnvName } from '../../../application/services/common-env/crypto';
import { createServiceDesiredStateService } from '../../../application/services/platform/worker-desired-state';
import { logError } from '../../../shared/utils/logger';
import { NotFoundError, InternalError } from 'takos-common/errors';

const settingsEnvVars = new Hono<AuthenticatedRouteEnv>()

.get('/:id/env', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');

  const worker = await getServiceForUser(c.env.DB, workerId, user.id);

  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const desiredState = createServiceDesiredStateService(c.env);
    const envVars = await desiredState.listLocalEnvVarSummaries(worker.space_id, worker.id);

    return c.json({
      env: envVars,
      applies_on_next_deploy: true,
    });
  } catch (err) {
    logError('Failed to get environment variables', err, { module: 'routes/services/settings' });
    throw new InternalError('Failed to get environment variables');
  }
})

.patch('/:id/env',
  zValidator('json', z.object({
    variables: z.array(z.object({
      name: z.string(),
      value: z.string(),
      secret: z.boolean().optional(),
    })),
  })),
  async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');
  const body = c.req.valid('json');

  if (!Array.isArray(body.variables)) {
    throw new BadRequestError( 'variables array is required');
  }

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);

  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const desiredState = createServiceDesiredStateService(c.env);
    const normalizedVariables = body.variables.map((v) => ({
      name: normalizeCommonEnvName(v.name) ?? v.name,
      value: v.value,
      secret: v.secret === true,
    }));
    await desiredState.replaceLocalEnvVars({
      spaceId: worker.space_id,
      workerId: worker.id,
      variables: normalizedVariables,
    });

    const commonEnvService = createCommonEnvService(c.env);
    const actor = await buildCommonEnvActor(c, user.id);
    const linkedKeyCandidates = normalizedVariables
      .map((v) => normalizeCommonEnvName(v.name))
      .filter((name): name is string => Boolean(name));
    await commonEnvService.markRequiredKeysLocallyOverridden({
      spaceId: worker.space_id,
      workerId: worker.id,
      keys: linkedKeyCandidates,
      actor,
    });
    await commonEnvService.reconcileWorkerCommonEnv(worker.space_id, worker.id, {
      trigger: 'worker_env_patch',
    });

    const env = await desiredState.listLocalEnvVarSummaries(worker.space_id, worker.id);

    return c.json({
      success: true,
      env,
      applies_on_next_deploy: true,
    });
  } catch (err) {
    logError('Failed to update environment variables', err, { module: 'routes/services/settings' });
    if (err instanceof Error) {
      throw new BadRequestError( err.message);
    }
    throw new InternalError('Failed to update environment variables');
  }
});

export default settingsEnvVars;
