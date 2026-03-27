import { Hono } from 'hono';
import { z } from 'zod';
import { badRequest } from '../shared/route-auth';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import { getServiceForUser, getServiceForUserWithRole } from '../../../application/services/platform/workers';
import { TAKOS_ACCESS_TOKEN_ENV_NAME, createCommonEnvService } from '../../../application/services/common-env';
import { buildCommonEnvActor } from '../common-env/common-env-handlers';
import { normalizeCommonEnvName } from '../../../application/services/common-env/crypto';
import { getDb } from '../../../infra/db';
import { eq, and, or, inArray } from 'drizzle-orm';
import { serviceCommonEnvLinks, resources, resourceAccess } from '../../../infra/db/schema';
import { createServiceDesiredStateService } from '../../../application/services/platform/worker-desired-state';
import { logError } from '../../../shared/utils/logger';
import { NotFoundError, InternalError } from '@takos/common/errors';

const workerBuiltinsSchema = z.object({
  TAKOS_ACCESS_TOKEN: z.object({
    scopes: z.array(z.string()).min(1),
  }).optional(),
}).optional();

const workerManagedMcpServerSchema = z.object({
  enabled: z.boolean(),
  name: z.string().min(1).max(64),
  path: z.string().min(1).regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/),
}).optional();

// Resource scope helper removed - replaced by inline Drizzle queries

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

const workersSettings = new Hono<AuthenticatedRouteEnv>()

.get('/:id/settings', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');

  const worker = await getServiceForUser(c.env.DB, workerId, user.id);

  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const desiredState = createServiceDesiredStateService(c.env);
    const settings = await desiredState.getRuntimeConfig(worker.space_id, worker.id);

    return c.json({
      compatibility_date: settings.compatibility_date,
      compatibility_flags: settings.compatibility_flags,
      limits: settings.limits,
      mcp_server: settings.mcp_server,
      applies_on_next_deploy: true,
      updated_at: settings.updated_at,
    });
  } catch (err) {
    logError('Failed to get service settings', err, { module: 'routes/services/settings' });
    throw new InternalError('Failed to get service settings');
  }
})

.patch('/:id/settings',
  zValidator('json', z.object({
    compatibility_date: z.string().optional(),
    compatibility_flags: z.array(z.string()).optional(),
    limits: z.object({
      cpu_ms: z.number().optional(),
      subrequests: z.number().optional(),
    }).optional(),
    mcp_server: workerManagedMcpServerSchema,
  })),
  async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');
  const body = c.req.valid('json');

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);

  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const desiredState = createServiceDesiredStateService(c.env);
    const settings = await desiredState.saveRuntimeConfig({
      spaceId: worker.space_id,
      workerId: worker.id,
      compatibilityDate: body.compatibility_date,
      compatibilityFlags: body.compatibility_flags,
      limits: body.limits,
      mcpServer: body.mcp_server,
    });

    return c.json({
      success: true,
      settings: {
        compatibility_date: settings.compatibility_date,
        compatibility_flags: settings.compatibility_flags,
        limits: settings.limits,
        mcp_server: settings.mcp_server,
        updated_at: settings.updated_at,
      },
      applies_on_next_deploy: true,
    });
  } catch (err) {
    logError('Failed to update service settings', err, { module: 'routes/services/settings' });
    throw new InternalError('Failed to update service settings');
  }
})

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
    return badRequest(c, 'variables array is required');
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
      return badRequest(c, err.message);
    }
    throw new InternalError('Failed to update environment variables');
  }
})

.get('/:id/common-env-links', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');

  const worker = await getServiceForUser(c.env.DB, workerId, user.id);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const commonEnvService = createCommonEnvService(c.env);
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
    return badRequest(c, 'keys must be an array');
  }

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const commonEnvService = createCommonEnvService(c.env);
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
      return badRequest(c, 'builtins.TAKOS_ACCESS_TOKEN requires TAKOS_ACCESS_TOKEN to be linked');
    }
    if (
      nextEffectiveHasTakosAccessToken
      && !body.builtins?.TAKOS_ACCESS_TOKEN
      && !currentBuiltins[TAKOS_ACCESS_TOKEN_ENV_NAME]?.configured
    ) {
      return badRequest(c, 'TAKOS_ACCESS_TOKEN requires builtins.TAKOS_ACCESS_TOKEN.scopes when first linked');
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
      return badRequest(c, err.message);
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
    return badRequest(c, 'add must be an array');
  }
  if (body.remove !== undefined && !Array.isArray(body.remove)) {
    return badRequest(c, 'remove must be an array');
  }
  if (body.set !== undefined && !Array.isArray(body.set)) {
    return badRequest(c, 'set must be an array');
  }
  const hasSet = body.set !== undefined;
  const hasAddOrRemove = body.add !== undefined || body.remove !== undefined;
  if (!hasSet && !hasAddOrRemove) {
    return badRequest(c, 'one of add/remove/set must be provided');
  }
  if (hasSet && hasAddOrRemove) {
    return badRequest(c, 'set cannot be combined with add/remove');
  }

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    const commonEnvService = createCommonEnvService(c.env);
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
      return badRequest(c, 'builtins.TAKOS_ACCESS_TOKEN requires TAKOS_ACCESS_TOKEN to be linked');
    }
    if (
      nextEffectiveHasTakosAccessToken
      && !body.builtins?.TAKOS_ACCESS_TOKEN
      && !currentBuiltins[TAKOS_ACCESS_TOKEN_ENV_NAME]?.configured
    ) {
      return badRequest(c, 'TAKOS_ACCESS_TOKEN requires builtins.TAKOS_ACCESS_TOKEN.scopes when first linked');
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
      return badRequest(c, err.message);
    }
    throw new InternalError('Failed to patch common env links');
  }
})

.get('/:id/bindings', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');
  const db = getDb(c.env.DB);

  const worker = await getServiceForUser(c.env.DB, workerId, user.id);

  if (!worker) {
    throw new NotFoundError('Service');
  }

  try {
    // Get resource IDs accessible via resourceAccess
    const accessibleResourceIds = await db.select({ resourceId: resourceAccess.resourceId })
      .from(resourceAccess)
      .where(eq(resourceAccess.accountId, worker.space_id))
      .all();
    const accessibleIds = accessibleResourceIds.map(r => r.resourceId);

    const resourceRows = await db.select({
      id: resources.id,
      name: resources.name,
      cfId: resources.cfId,
      cfName: resources.cfName,
    }).from(resources).where(
      and(
        eq(resources.status, 'active'),
        or(
          eq(resources.accountId, worker.space_id),
          accessibleIds.length > 0 ? inArray(resources.id, accessibleIds) : undefined,
        ),
      )
    ).all();
    const resourceList = resourceRows.map(r => ({
      id: r.id,
      name: r.name,
      cf_id: r.cfId,
      cf_name: r.cfName,
    }));

    const desiredState = createServiceDesiredStateService(c.env);
    const bindings = await desiredState.listResourceBindings(worker.id);

    return c.json({
      bindings,
      available_resources: resourceList,
      applies_on_next_deploy: true,
    });
  } catch (err) {
    logError('Failed to get bindings', err, { module: 'routes/services/settings' });
    throw new InternalError('Failed to get bindings');
  }
})

.patch('/:id/bindings',
  zValidator('json', z.object({
    bindings: z.array(z.object({
      name: z.string(),
      type: z.string(),
      resource_id: z.string().optional(),
      resource_name: z.string().optional(),
    })),
  })),
  async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);

  if (!worker) {
    throw new NotFoundError('Service');
  }

  const body = c.req.valid('json');

  if (!body.bindings || !Array.isArray(body.bindings)) {
    return badRequest(c, 'bindings array is required');
  }

  const db = getDb(c.env.DB);

  try {
    // Get accessible resource IDs via resourceAccess
    const accessibleResourceIds = await db.select({ resourceId: resourceAccess.resourceId })
      .from(resourceAccess)
      .where(eq(resourceAccess.accountId, worker.space_id))
      .all();
    const accessibleIds = accessibleResourceIds.map(r => r.resourceId);

    const nextBindings: Array<{ name: string; type: string; resourceId: string; config?: Record<string, unknown> }> = [];

    for (const binding of body.bindings) {
      let resource: { id: string; type: string } | null = null;

      if (binding.resource_id) {
        resource = await db.select({
          id: resources.id,
          type: resources.type,
        }).from(resources).where(
          and(
            eq(resources.id, binding.resource_id),
            eq(resources.status, 'active'),
            or(
              eq(resources.accountId, worker.space_id),
              accessibleIds.length > 0 ? inArray(resources.id, accessibleIds) : undefined,
            ),
          )
        ).get() ?? null;
      } else if (binding.resource_name) {
        resource = await db.select({
          id: resources.id,
          type: resources.type,
        }).from(resources).where(
          and(
            eq(resources.name, binding.resource_name),
            eq(resources.status, 'active'),
            or(
              eq(resources.accountId, worker.space_id),
              accessibleIds.length > 0 ? inArray(resources.id, accessibleIds) : undefined,
            ),
          )
        ).get() ?? null;
      }

      if (!resource) {
        return badRequest(c, `Resource not found for binding: ${binding.name}`);
      }

      let bindingType: string;
      switch (resource.type) {
        case 'd1':
        case 'r2':
        case 'kv':
          bindingType = resource.type;
          break;
        case 'worker':
          bindingType = 'service';
          break;
        default:
          return badRequest(c, `Unsupported binding resource type: ${resource.type}`);
      }

      nextBindings.push({
        name: binding.name,
        type: bindingType,
        resourceId: resource.id,
      });
    }

    const desiredState = createServiceDesiredStateService(c.env);
    await desiredState.replaceResourceBindings({
      workerId: worker.id,
      bindings: nextBindings,
    });

    return c.json({
      success: true,
      applies_on_next_deploy: true,
    });
  } catch (err) {
    logError('Failed to update bindings', err, { module: 'routes/services/settings' });
    if (err instanceof Error) {
      return badRequest(c, err.message);
    }
    throw new InternalError('Failed to update bindings');
  }
});

export default workersSettings;
