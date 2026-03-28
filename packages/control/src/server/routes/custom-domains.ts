import { Hono } from 'hono';
import { z } from 'zod';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../../shared/types';
import type { BaseVariables } from './route-auth';
import { zValidator } from './zod-validator';
import { logError } from '../../shared/utils/logger';
import { AppError, BadRequestError, InternalError, ErrorCodes } from 'takos-common/errors';
import {
  addCustomDomain,
  CustomDomainError,
  deleteCustomDomain,
  getCustomDomainDetails,
  listCustomDomains,
  refreshSslStatus,
  verifyCustomDomain,
} from '../../application/services/platform/custom-domains';

type AppEnv = { Bindings: Env; Variables: BaseVariables };
type AppContext = Context<AppEnv>;

function toStatusCode(status: number): ContentfulStatusCode {
  return status as ContentfulStatusCode;
}

function handleCustomDomainError(err: unknown, fallbackMessage: string): never {
  if (err instanceof CustomDomainError) {
    throw new AppError(err.message, ErrorCodes.INTERNAL_ERROR, err.status, err.details);
  }
  logError('[custom-domains]', err, { module: 'custom-domains' });
  throw new InternalError(fallbackMessage);
}

async function listCustomDomainsHandler(c: AppContext) {
  const user = c.get('user');
  const serviceId = c.req.param('id');
  if (!serviceId) throw new BadRequestError('Missing serviceId');

  try {
    const data = await listCustomDomains(c.env, serviceId, user.id);
    return c.json(data);
  } catch (err) {
    handleCustomDomainError(err, 'Failed to list custom domains');
  }
}

async function verifyCustomDomainHandler(c: AppContext) {
  const user = c.get('user');
  const serviceId = c.req.param('id');
  const domainId = c.req.param('domainId');
  if (!serviceId) throw new BadRequestError('Missing serviceId');
  if (!domainId) throw new BadRequestError('Missing domainId');

  try {
    const result = await verifyCustomDomain(c.env, serviceId, user.id, domainId);
    return c.json(result.body, toStatusCode(result.status));
  } catch (err) {
    handleCustomDomainError(err, 'Failed to verify custom domain');
  }
}

async function getCustomDomainDetailsHandler(c: AppContext) {
  const user = c.get('user');
  const serviceId = c.req.param('id');
  const domainId = c.req.param('domainId');
  if (!serviceId) throw new BadRequestError('Missing serviceId');
  if (!domainId) throw new BadRequestError('Missing domainId');

  try {
    const data = await getCustomDomainDetails(c.env, serviceId, user.id, domainId);
    return c.json(data);
  } catch (err) {
    handleCustomDomainError(err, 'Failed to get custom domain details');
  }
}

async function deleteCustomDomainHandler(c: AppContext) {
  const user = c.get('user');
  const serviceId = c.req.param('id');
  const domainId = c.req.param('domainId');
  if (!serviceId) throw new BadRequestError('Missing serviceId');
  if (!domainId) throw new BadRequestError('Missing domainId');

  try {
    const data = await deleteCustomDomain(c.env, serviceId, user.id, domainId);
    return c.json(data);
  } catch (err) {
    handleCustomDomainError(err, 'Failed to delete custom domain');
  }
}

async function refreshSslStatusHandler(c: AppContext) {
  const user = c.get('user');
  const serviceId = c.req.param('id');
  const domainId = c.req.param('domainId');
  if (!serviceId) throw new BadRequestError('Missing serviceId');
  if (!domainId) throw new BadRequestError('Missing domainId');

  try {
    const data = await refreshSslStatus(c.env, serviceId, user.id, domainId);
    return c.json(data);
  } catch (err) {
    handleCustomDomainError(err, 'Failed to refresh SSL status');
  }
}

const addCustomDomainSchema = z.object({
  domain: z.string(),
  verification_method: z.enum(['cname', 'txt']).optional(),
});

async function addCustomDomainHandler(c: AppContext) {
  const user = c.get('user');
  const serviceId = c.req.param('id');
  if (!serviceId) throw new BadRequestError('Missing serviceId');
  const body = c.req.valid('json' as never) as z.infer<typeof addCustomDomainSchema>;
  try {
    const result = await addCustomDomain(c.env, serviceId, user.id, body);
    return c.json(result.body, toStatusCode(result.status));
  } catch (err) {
    handleCustomDomainError(err, 'Failed to create custom domain');
  }
}

export default new Hono<AppEnv>()
  .get('/services/:id/custom-domains', listCustomDomainsHandler)
  .post('/services/:id/custom-domains', zValidator('json', addCustomDomainSchema), addCustomDomainHandler)
  .post('/services/:id/custom-domains/:domainId/verify', verifyCustomDomainHandler)
  .get('/services/:id/custom-domains/:domainId', getCustomDomainDetailsHandler)
  .delete('/services/:id/custom-domains/:domainId', deleteCustomDomainHandler)
  .post('/services/:id/custom-domains/:domainId/refresh-ssl', refreshSslStatusHandler);
