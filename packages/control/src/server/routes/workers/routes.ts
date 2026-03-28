import { Hono } from 'hono';
import { z } from 'zod';
import { parseLimit, requireSpaceAccess } from '../shared/route-auth';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import {
  countServicesInSpace,
  createService,
  deleteService,
  getServiceForUser,
  getServiceForUserWithRole,
  listServicesForUser,
  listServicesForSpace,
  WORKSPACE_SERVICE_LIMITS,
} from '../../../application/services/platform/workers';
import { getDb } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import { deployments, serviceCustomDomains, serviceDeployments } from '../../../infra/db/schema';
import { deleteHostnameRouting } from '../../../application/services/routing/service';
import { createCloudflareApiClient } from '../../../application/services/cloudflare/api-client.ts';
import { deleteCloudflareCustomHostname } from '../../../application/services/platform/custom-domains.ts';
import { CommonEnvService } from '../../../application/services/common-env';
import { ServiceDesiredStateService } from '../../../application/services/platform/worker-desired-state';
import { createOptionalCloudflareWfpProvider } from '../../../platform/providers/cloudflare/wfp.ts';
import { logWarn } from '../../../shared/utils/logger';
import { NotFoundError, InternalError } from 'takos-common/errors';

/** Shape of a single invocation record from the Cloudflare GraphQL Analytics API */
interface CfInvocationRecord {
  datetime: string;
  status: string;
  cpuTime: number;
  responseStatus: number;
  clientRequestMethod: string;
  clientRequestPath: string;
}

/** Response shape from the Cloudflare GraphQL Analytics API */
interface CfGraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        workersInvocationsAdaptive?: CfInvocationRecord[];
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

const workersBase = new Hono<AuthenticatedRouteEnv>()

.get('/', async (c) => {
  const user = c.get('user');

  const workersList = await listServicesForUser(c.env.DB, user.id);

  return c.json({ services: workersList });
})

.get('/space/:spaceId', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');

  const access = await requireSpaceAccess(c, spaceId, user.id);

  const workersList = await listServicesForSpace(c.env.DB, access.space.id);

  return c.json({ services: workersList });
})

.post('/',
  zValidator('json', z.object({
    space_id: z.string().optional(),
    service_type: z.enum(['app', 'service']).optional(),
    slug: z.string().optional(),
    config: z.string().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const spaceId = body.space_id || null;

  let resolvedSpaceId: string;
  if (spaceId) {
    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Space not found or insufficient permissions'
    );
    resolvedSpaceId = access.space.id;
  } else {
    // Default to user's own account
    resolvedSpaceId = user.id;
  }

  const serviceType = body.service_type || 'app';

  const currentCount = await countServicesInSpace(c.env.DB, resolvedSpaceId);
  if (currentCount >= WORKSPACE_SERVICE_LIMITS.maxServices) {
    return c.json({
      error: `Space has reached the maximum number of services (${WORKSPACE_SERVICE_LIMITS.maxServices})`
    }, 429);
  }

  const platformDomain = c.env.TENANT_BASE_DOMAIN;

  const result = await createService(c.env.DB, {
    spaceId: resolvedSpaceId,
    workerType: serviceType,
    slug: body.slug,
    config: body.config || null,
    platformDomain,
  });

  return c.json({ service: result.service }, 201);
})

.get('/:id', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');

  const worker = await getServiceForUser(c.env.DB, workerId, user.id);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  return c.json({ service: worker });
})

.get('/:id/logs', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const sinceHours = parseLimit(c.req.query('since'), 1, 72);

  if (!c.env.CF_ACCOUNT_ID || !c.env.CF_API_TOKEN) {
    throw new InternalError('Cloudflare API not configured');
  }

  const worker = await getServiceForUser(c.env.DB, workerId, user.id);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  const desiredState = new ServiceDesiredStateService(c.env);
  const scriptName = await desiredState.getCurrentDeploymentArtifactRef(worker.id);

  if (!scriptName) {
    return c.json({ invocations: [] });
  }

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - sinceHours * 60 * 60 * 1000);

  const query = `
    query GetWorkerInvocations($accountTag: String!, $scriptName: String!, $startTime: Time!, $endTime: Time!, $limit: Int!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            filter: {
              scriptName: $scriptName
              datetime_geq: $startTime
              datetime_leq: $endTime
            }
            limit: $limit
            orderBy: [datetime_DESC]
          ) {
            datetime
            status
            cpuTime
            responseStatus
            clientRequestMethod
            clientRequestPath
          }
        }
      }
    }
  `;

  const cfClient = createCloudflareApiClient(c.env);
  if (!cfClient) {
    throw new InternalError('Cloudflare API not configured');
  }

  const gqlResponse = await cfClient.fetchRaw('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: c.env.CF_ACCOUNT_ID,
        scriptName,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        limit,
      },
    }),
  });

  const result = await gqlResponse.json() as CfGraphQLResponse;

  if (result.errors?.length) {
    throw new InternalError(result.errors[0].message);
  }

  const invocations = result.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
  return c.json({ invocations });
})

.delete('/:id', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');

  const worker = await getServiceForUserWithRole(
    c.env.DB,
    workerId,
    user.id,
    ['owner', 'admin']
  );

  if (!worker) {
    throw new NotFoundError('Service');
  }

  const db = getDb(c.env.DB);

  const workerCustomDomains = db.select({
    id: serviceCustomDomains.id,
    domain: serviceCustomDomains.domain,
    cfCustomHostnameId: serviceCustomDomains.cfCustomHostnameId,
  }).from(serviceCustomDomains).where(eq(serviceCustomDomains.serviceId, workerId)).all();

  const resolvedCustomDomains = await workerCustomDomains;

  for (const customDomain of resolvedCustomDomains) {
    try {
      await deleteHostnameRouting({ env: c.env, hostname: customDomain.domain, executionCtx: c.executionCtx });
    } catch (e) {
      logWarn('Failed to delete custom domain routing', { module: 'routes/services/base', error: e instanceof Error ? e.message : String(e) });
    }
    if (customDomain.cfCustomHostnameId) {
      try {
        await deleteCloudflareCustomHostname(c.env, customDomain.cfCustomHostnameId);
      } catch (e) {
        logWarn('Failed to delete CF custom hostname', { module: 'routes/services/base', error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  if (resolvedCustomDomains.length > 0) {
    await db.delete(serviceCustomDomains).where(eq(serviceCustomDomains.serviceId, workerId));
  }

  if (worker.hostname) {
    try {
      await deleteHostnameRouting({ env: c.env, hostname: worker.hostname, executionCtx: c.executionCtx });
    } catch (e) {
      logWarn('Failed to delete hostname routing', { module: 'routes/services/base', error: e instanceof Error ? e.message : String(e) });
    }
  }

  const deploymentArtifacts = await db.select({ artifactRef: deployments.artifactRef }).from(deployments).where(eq(serviceDeployments.serviceId, workerId)).all();

  const artifactRefs = new Set<string>();
  if (worker.service_name) {
    artifactRefs.add(worker.service_name);
  }
  for (const deployment of deploymentArtifacts) {
    if (deployment.artifactRef) {
      artifactRefs.add(deployment.artifactRef);
    }
  }

  if (artifactRefs.size > 0) {
  const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      logWarn('Skipping WFP artifact cleanup because Cloudflare WFP is not configured', {
        module: 'routes/services/base',
        details: Array.from(artifactRefs),
      });
    } else {
      for (const artifactRef of artifactRefs) {
        try {
          await wfp.workers.deleteWorker(artifactRef);
        } catch (e) {
          logWarn('Failed to delete WFP artifact', { module: 'routes/services/base', details: [artifactRef, e instanceof Error ? e.message : String(e)] });
        }
      }
    }
  }

  const commonEnvService = new CommonEnvService(c.env);
  await commonEnvService.deleteWorkerTakosAccessTokenConfig({
    spaceId: worker.space_id,
    workerId: worker.id,
  });
  await deleteService(c.env.DB, workerId);

  return c.json({ success: true });
});

export default workersBase;
