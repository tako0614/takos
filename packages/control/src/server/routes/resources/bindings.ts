import { Hono } from 'hono';
import { generateId } from '../../../shared/utils/index.ts';
import { parseJsonBody, type AuthenticatedRouteEnv } from '../route-auth.ts';
import { BadRequestError } from 'takos-common/errors';
import {
  checkResourceAccess,
  createServiceBinding,
  deleteServiceBinding,
  getResourceById,
  getResourceByName,
} from '../../../application/services/resources/index.ts';
import { getDb, services } from '../../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';
import { resolveActorPrincipalId } from '../../../application/services/identity/principals.ts';
import { AuthorizationError, NotFoundError, ConflictError, InternalError } from 'takos-common/errors';

const resourcesBindings = new Hono<AuthenticatedRouteEnv>()

.post('/:id/bind', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const body = await parseJsonBody<{
    service_id: string;
    binding_name: string;
    config?: Record<string, unknown>;
  }>(c);

  if (!body) {
    throw new BadRequestError( 'Invalid JSON body');
  }

  const resource = await getResourceById(c.env.DB, resourceId);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  const hasAccess = resource.owner_id === user.id ||
    await checkResourceAccess(c.env.DB, resourceId, user.id, ['write', 'admin']);

  if (!hasAccess) {
    throw new AuthorizationError();
  }

  const db = getDb(c.env.DB);
  const principalId = await resolveActorPrincipalId(c.env.DB, user.id);
  if (!principalId) {
    throw new InternalError('User principal not found');
  }
  const service = await db.select().from(services).where(
    and(eq(services.id, body.service_id), eq(services.accountId, principalId))
  ).get();

  if (!service) {
    throw new NotFoundError('Service');
  }

  const id = generateId();
  const timestamp = new Date().toISOString();
  const bindingType = resource.type === 'worker' ? 'service' : resource.type;

  try {
    await createServiceBinding(c.env.DB, {
      id,
      service_id: body.service_id,
      resource_id: resourceId,
      binding_name: body.binding_name,
      binding_type: bindingType,
      config: body.config || {},
      created_at: timestamp,
    });

    return c.json({
      binding: {
        id,
        service_id: body.service_id,
        resource_id: resourceId,
        binding_name: body.binding_name,
        binding_type: bindingType,
        config: JSON.stringify(body.config || {}),
        created_at: timestamp,
      }
    }, 201);
  } catch (err) {
    if (String(err).includes('UNIQUE constraint')) {
      throw new ConflictError('Binding name already exists for this service');
    }
    throw err;
  }
})

.delete('/:id/bind/:serviceId', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const serviceId = c.req.param('serviceId');
  const db = getDb(c.env.DB);
  const principalId = await resolveActorPrincipalId(c.env.DB, user.id);
  if (!principalId) {
    throw new InternalError('User principal not found');
  }

  const resource = await getResourceById(c.env.DB, resourceId);
  if (!resource) {
    throw new NotFoundError('Resource');
  }

  const hasAccess = resource.owner_id === user.id ||
    await checkResourceAccess(c.env.DB, resourceId, user.id, ['write', 'admin']);

  if (!hasAccess) {
    throw new AuthorizationError();
  }

  const service = await db.select().from(services).where(
    and(eq(services.id, serviceId), eq(services.accountId, principalId))
  ).get();

  if (!service) {
    throw new NotFoundError('Service');
  }

  await deleteServiceBinding(c.env.DB, resourceId, serviceId);

  return c.json({ success: true });
})

.delete('/by-name/:name/bind/:serviceId', async (c) => {
  const user = c.get('user');
  const resourceName = decodeURIComponent(c.req.param('name'));
  const serviceId = c.req.param('serviceId');
  const db = getDb(c.env.DB);
  const principalId = await resolveActorPrincipalId(c.env.DB, user.id);
  if (!principalId) {
    throw new InternalError('User principal not found');
  }

  const resource = await getResourceByName(c.env.DB, user.id, resourceName);
  if (!resource) {
    throw new NotFoundError('Resource');
  }

  const resourceId = resource._internal_id;

  const service = await db.select().from(services).where(
    and(eq(services.id, serviceId), eq(services.accountId, principalId))
  ).get();

  if (!service) {
    throw new NotFoundError('Service');
  }

  await deleteServiceBinding(c.env.DB, resourceId, serviceId);

  return c.json({ success: true });
});

export default resourcesBindings;
