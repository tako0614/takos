import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { BadRequestError } from 'takos-common/errors';
import { zValidator } from '../zod-validator';
import { getServiceForUser, getServiceForUserWithRole } from '../../../application/services/platform/workers';
import { TAKOS_ACCESS_TOKEN_ENV_NAME, CommonEnvService } from '../../../application/services/common-env';
import { buildCommonEnvActor } from '../common-env/handlers';
import { normalizeCommonEnvName } from '../../../application/services/common-env/crypto';
import { getDb } from '../../../infra/db';
import { eq, and } from 'drizzle-orm';
import { serviceCommonEnvLinks } from '../../../infra/db/schema';
import { logError } from '../../../shared/utils/logger';
import { NotFoundError, InternalError } from 'takos-common/errors';

const workerBuiltinsSchema = z.object({
  TAKOS_ACCESS_TOKEN: z.object({
    scopes: z.array(z.string()).min(1),
  }).optional(),
}).optional();

function touchesTakosAccessToken(params: {
  currentManualKeys: string[];
  nextManualKeys: string[];
  builtins?: { TAKOS_ACCESS_TOKEN?: { scopes: string[] } };
}): boolean {
  const current = new Set(params.currentManualKeys);
  const next = new Set(params.nextManualKeys);
  return Boolean(
    params.builtins?.TAKOS_ACCESS_TOKEN
    || current.has(TAKOS_ACCESS_TOKEN_ENV_NAME)
    || next.has(TAKOS_ACCESS_TOKEN_ENV_NAME)
  );
}

async function getCurrentTakosAccessTokenLinkPresence(
  env: AuthenticatedRouteEnv['Bindings'],
  spaceId: string,
  workerId: string,
): Promise<{ manual: boolean; required: boolean }> {
  const db = getDb(env.DB);
  const rows = await db.select({ source: serviceCommonEnvLinks.source })
    .from(serviceCommonEnvLinks)
    .where(and(
      eq(serviceCommonEnvLinks.accountId, spaceId),
      eq(serviceCommonEnvLinks.serviceId, workerId),
      eq(serviceCommonEnvLinks.envName, TAKOS_ACCESS_TOKEN_ENV_NAME),
    ))
    .all();

  const sources = new Set(rows.map((row) => row.source));
  return {
    manual: sources.has('manual'),
    required: sources.has('required'),
  };
}

const settingsCommonEnv = new Hono<AuthenticatedRouteEnv>()

.get('/:id/common-env-links', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');

  const worker = await getServiceForUser(c.env.DB, workerId, user.id);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const commonEnvService = new CommonEnvService(c.env);
    const links = await commonEnvService.listWorkerCommonEnvLinks(worker.space_id, worker.id);
    const builtins = await commonEnvService.listWorkerBuiltins(worker.space_id, worker.id);
    return c.json({ links, builtins });
  } catch (err) {
    logError('Failed to get service common env links', err, { module: 'routes/services/settings' });
    throw new InternalError('Failed to get common env links');
  }
})

.put('/:id/common-env-links',
  zValidator('json', z.object({
    keys: z.array(z.string()).optional(),
    builtins: workerBuiltinsSchema,
  })),
  async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');
  const body = c.req.valid('json');

  if (body.keys && !Array.isArray(body.keys)) {
    throw new BadRequestError( 'keys must be an array');
  }

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const commonEnvService = new CommonEnvService(c.env);
    const currentManualKeys = await commonEnvService.listWorkerManualLinkNames(worker.space_id, worker.id);
    const currentBuiltins = await commonEnvService.listWorkerBuiltins(worker.space_id, worker.id);
    const currentTakosLink = await getCurrentTakosAccessTokenLinkPresence(c.env, worker.space_id, worker.id);
    const nextManualKeys = (body.keys || []).map((key) => normalizeCommonEnvName(key) ?? key).filter(Boolean) as string[];
    const nextEffectiveHasTakosAccessToken = nextManualKeys.includes(TAKOS_ACCESS_TOKEN_ENV_NAME) || currentTakosLink.required;

    if (touchesTakosAccessToken({
      currentManualKeys,
      nextManualKeys,
      builtins: body.builtins,
    })) {
      const privilegedWorker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin']);
      if (!privilegedWorker) {
        throw new NotFoundError('Service');
      }
    }

    if (body.builtins?.TAKOS_ACCESS_TOKEN && !nextEffectiveHasTakosAccessToken) {
      throw new BadRequestError( 'builtins.TAKOS_ACCESS_TOKEN requires TAKOS_ACCESS_TOKEN to be linked');
    }
    if (
      nextEffectiveHasTakosAccessToken
      && !body.builtins?.TAKOS_ACCESS_TOKEN
      && !currentBuiltins[TAKOS_ACCESS_TOKEN_ENV_NAME]?.configured
    ) {
      throw new BadRequestError( 'TAKOS_ACCESS_TOKEN requires builtins.TAKOS_ACCESS_TOKEN.scopes when first linked');
    }

    const actor = await buildCommonEnvActor(c, user.id);
    await commonEnvService.setWorkerManualLinks({
      spaceId: worker.space_id,
      workerId: worker.id,
      keys: nextManualKeys,
      actor,
    });
    if (!nextEffectiveHasTakosAccessToken) {
      await commonEnvService.deleteWorkerTakosAccessTokenConfig({
        spaceId: worker.space_id,
        workerId: worker.id,
      });
    } else if (body.builtins?.TAKOS_ACCESS_TOKEN) {
      await commonEnvService.upsertWorkerTakosAccessTokenConfig({
        spaceId: worker.space_id,
        workerId: worker.id,
        scopes: body.builtins.TAKOS_ACCESS_TOKEN.scopes,
      });
    }
    const links = await commonEnvService.listWorkerCommonEnvLinks(worker.space_id, worker.id);
    const builtins = await commonEnvService.listWorkerBuiltins(worker.space_id, worker.id);
    return c.json({ success: true, links, builtins });
  } catch (err) {
    logError('Failed to update service common env links', err, { module: 'routes/services/settings' });
    if (err instanceof Error) {
      throw new BadRequestError( err.message);
    }
    throw new InternalError('Failed to update common env links');
  }
})

.patch('/:id/common-env-links',
  zValidator('json', z.object({
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
    set: z.array(z.string()).optional(),
    builtins: workerBuiltinsSchema,
  })),
  async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');
  const body = c.req.valid('json');

  if (body.add !== undefined && !Array.isArray(body.add)) {
    throw new BadRequestError( 'add must be an array');
  }
  if (body.remove !== undefined && !Array.isArray(body.remove)) {
    throw new BadRequestError( 'remove must be an array');
  }
  if (body.set !== undefined && !Array.isArray(body.set)) {
    throw new BadRequestError( 'set must be an array');
  }
  const hasSet = body.set !== undefined;
  const hasAddOrRemove = body.add !== undefined || body.remove !== undefined;
  if (!hasSet && !hasAddOrRemove) {
    throw new BadRequestError( 'one of add/remove/set must be provided');
  }
  if (hasSet && hasAddOrRemove) {
    throw new BadRequestError( 'set cannot be combined with add/remove');
  }

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const commonEnvService = new CommonEnvService(c.env);
    const currentManualKeys = await commonEnvService.listWorkerManualLinkNames(worker.space_id, worker.id);
    const currentBuiltins = await commonEnvService.listWorkerBuiltins(worker.space_id, worker.id);
    const currentTakosLink = await getCurrentTakosAccessTokenLinkPresence(c.env, worker.space_id, worker.id);
    const nextSet = hasSet
      ? new Set((body.set || []).map((key) => normalizeCommonEnvName(key) ?? key).filter(Boolean) as string[])
      : new Set(currentManualKeys);

    if (!hasSet) {
      for (const key of body.add || []) {
        const normalized = normalizeCommonEnvName(key);
        if (normalized) nextSet.add(normalized);
      }
      for (const key of body.remove || []) {
        const normalized = normalizeCommonEnvName(key);
        if (normalized) nextSet.delete(normalized);
      }
    }

    const nextManualKeys = Array.from(nextSet.values());
    const nextEffectiveHasTakosAccessToken = nextSet.has(TAKOS_ACCESS_TOKEN_ENV_NAME) || currentTakosLink.required;
    if (touchesTakosAccessToken({
      currentManualKeys,
      nextManualKeys,
      builtins: body.builtins,
    })) {
      const privilegedWorker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin']);
      if (!privilegedWorker) {
        throw new NotFoundError('Service');
      }
    }

    if (body.builtins?.TAKOS_ACCESS_TOKEN && !nextEffectiveHasTakosAccessToken) {
      throw new BadRequestError( 'builtins.TAKOS_ACCESS_TOKEN requires TAKOS_ACCESS_TOKEN to be linked');
    }
    if (
      nextEffectiveHasTakosAccessToken
      && !body.builtins?.TAKOS_ACCESS_TOKEN
      && !currentBuiltins[TAKOS_ACCESS_TOKEN_ENV_NAME]?.configured
    ) {
      throw new BadRequestError( 'TAKOS_ACCESS_TOKEN requires builtins.TAKOS_ACCESS_TOKEN.scopes when first linked');
    }

    const actor = await buildCommonEnvActor(c, user.id);
    const diff = await commonEnvService.patchWorkerManualLinks({
      spaceId: worker.space_id,
      workerId: worker.id,
      add: body.add,
      remove: body.remove,
      set: body.set,
      actor,
    });
    if (!nextEffectiveHasTakosAccessToken) {
      await commonEnvService.deleteWorkerTakosAccessTokenConfig({
        spaceId: worker.space_id,
        workerId: worker.id,
      });
    } else if (body.builtins?.TAKOS_ACCESS_TOKEN) {
      await commonEnvService.upsertWorkerTakosAccessTokenConfig({
        spaceId: worker.space_id,
        workerId: worker.id,
        scopes: body.builtins.TAKOS_ACCESS_TOKEN.scopes,
      });
    }
    const links = await commonEnvService.listWorkerCommonEnvLinks(worker.space_id, worker.id);
    const builtins = await commonEnvService.listWorkerBuiltins(worker.space_id, worker.id);
    return c.json({ success: true, diff, links, builtins });
  } catch (err) {
    logError('Failed to patch service common env links', err, { module: 'routes/services/settings' });
    if (err instanceof Error) {
      throw new BadRequestError( err.message);
    }
    throw new InternalError('Failed to patch common env links');
  }
});

export default settingsCommonEnv;
