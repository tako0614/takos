import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticatedRouteEnv } from '../route-auth';
import { BadRequestError } from 'takos-common/errors';
import { zValidator } from '../zod-validator';
import { getServiceForUserWithRole, slugifyServiceName } from '../../../application/services/platform/workers';
import { getDb } from '../../../infra/db';
import { eq, and, or, ne } from 'drizzle-orm';
import { services } from '../../../infra/db/schema-services';
import { deleteHostnameRouting, resolveHostnameRouting, upsertHostnameRouting } from '../../../application/services/routing/service';
import type { RoutingTarget } from '../../../application/services/routing/routing-models';
import { ServiceDesiredStateService } from '../../../application/services/platform/worker-desired-state';
import { logError } from '../../../shared/utils/logger';
import { NotFoundError, ConflictError, InternalError } from 'takos-common/errors';

const workersSlug = new Hono<AuthenticatedRouteEnv>()

.patch('/:id/slug',
  zValidator('json', z.object({
    slug: z.string(),
  })),
  async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');
  const body = c.req.valid('json');

  if (!body.slug) {
    throw new BadRequestError( 'slug is required');
  }

  const newSlug = slugifyServiceName(body.slug);
  if (newSlug.length < 3 || newSlug.length > 32) {
    throw new BadRequestError( 'Slug must be between 3 and 32 characters');
  }

  const reserved = ['admin', 'api', 'www', 'mail', 'smtp', 'pop', 'imap', 'ftp', 'app', 'apps'];
  if (reserved.includes(newSlug)) {
    throw new BadRequestError( 'This subdomain is reserved');
  }

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);

  if (!worker) {
    throw new NotFoundError('Service');
  }

  const db = getDb(c.env.DB);
  const desiredState = new ServiceDesiredStateService(c.env);
  const platformDomain = c.env.TENANT_BASE_DOMAIN;
  const newHostname = `${newSlug}.${platformDomain}`;

  const existing = await db.select({ id: services.id })
    .from(services)
    .where(and(
      or(
        eq(services.slug, newSlug),
        eq(services.hostname, newHostname),
      ),
      ne(services.id, workerId),
    ))
    .get() ?? null;

  if (existing) {
    throw new ConflictError('Slug or hostname already taken');
  }

  // Store old hostname for potential rollback
  const oldHostname = worker.hostname;
  let oldRoutingTarget: RoutingTarget | null = null;

  try {
    // Step 1: Delete old hostname routing
    if (oldHostname) {
      const resolved = await resolveHostnameRouting({ env: c.env, hostname: oldHostname, executionCtx: c.executionCtx });
      oldRoutingTarget = resolved.tombstone ? null : resolved.target;
      await deleteHostnameRouting({ env: c.env, hostname: oldHostname, executionCtx: c.executionCtx });
    }

    // Step 2: Update database
    await db.update(services)
      .set({
        slug: newSlug,
        hostname: newHostname,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(services.id, workerId));

    // Step 3: Add new hostname routing
    const fallbackTarget = oldRoutingTarget ?? await desiredState.getRoutingTarget(worker.id);
    if (fallbackTarget) {
      try {
        await upsertHostnameRouting({
          env: c.env,
          hostname: newHostname,
          target: fallbackTarget,
          executionCtx: c.executionCtx,
        });
      } catch (kvError) {
        // KV put failed, rollback DB changes
        logError('KV put failed, rolling back DB', kvError, { module: 'routes/services/slug' });
        await db.update(services)
          .set({
            slug: worker.slug,
            hostname: oldHostname,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(services.id, workerId));
        // Restore old hostname routing
        if (oldHostname && fallbackTarget) {
          await upsertHostnameRouting({
            env: c.env,
            hostname: oldHostname,
            target: oldRoutingTarget ?? fallbackTarget,
            executionCtx: c.executionCtx,
          });
        }
        throw kvError;
      }
    }

    return c.json({
      success: true,
      slug: newSlug,
      hostname: newHostname,
    });
  } catch (err) {
    // If DB update failed after KV delete, try to restore old routing
    if (oldHostname) {
      try {
        const fallbackTarget = oldRoutingTarget ?? await desiredState.getRoutingTarget(worker.id);
        if (!fallbackTarget) {
          throw new Error('No active deployment routing target available');
        }
        await upsertHostnameRouting({
          env: c.env,
          hostname: oldHostname,
          target: oldRoutingTarget ?? fallbackTarget,
          executionCtx: c.executionCtx,
        });
      } catch (restoreErr) {
        logError('Failed to restore old hostname routing', restoreErr, { module: 'routes/services/slug' });
      }
    }
    logError('Failed to update slug', err, { module: 'routes/services/slug' });
    throw new InternalError('Failed to update slug');
  }
});

export default workersSlug;
