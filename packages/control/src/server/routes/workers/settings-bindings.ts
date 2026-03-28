import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { BadRequestError } from '@takoserver/common/errors';
import { zValidator } from '../zod-validator';
import { getServiceForUser, getServiceForUserWithRole } from '../../../application/services/platform/workers';
import { getDb } from '../../../infra/db';
import { eq, and, or, inArray } from 'drizzle-orm';
import { resources, resourceAccess } from '../../../infra/db/schema';
import { createServiceDesiredStateService } from '../../../application/services/platform/worker-desired-state';
import { logError } from '../../../shared/utils/logger';
import { NotFoundError, InternalError } from '@takoserver/common/errors';

const settingsBindings = new Hono<AuthenticatedRouteEnv>()

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
    throw new BadRequestError( 'bindings array is required');
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
        throw new BadRequestError( `Resource not found for binding: ${binding.name}`);
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
          throw new BadRequestError( `Unsupported binding resource type: ${resource.type}`);
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
      throw new BadRequestError( err.message);
    }
    throw new InternalError('Failed to update bindings');
  }
});

export default settingsBindings;
