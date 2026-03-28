import { Hono } from 'hono';
import { z } from 'zod';
import { parseLimit } from '../shared/route-auth';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { BadRequestError } from '@takoserver/common/errors';
import { zValidator } from '../zod-validator';
import { createDeploymentService } from '../../../application/services/deployment/index';
import { parseDeploymentTargetConfig } from '../../../application/services/deployment/provider';
import type { ArtifactKind, DeploymentProviderName } from '../../../application/services/deployment/models.ts';
import { DEPLOYMENT_QUEUE_MESSAGE_VERSION } from '../../../shared/types';
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import { getServiceForUser, getServiceForUserWithRole } from '../../../application/services/platform/workers';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import { logWarn } from '../../../shared/utils/logger';
import { NotFoundError } from '@takoserver/common/errors';

const MAX_BUNDLE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB (Cloudflare Workers paid plan limit)

type ApiDeploymentEvent = {
  id: string;
  type: string;
  message: string;
  created_at: string;
};

type ApiDeploymentSummary = {
  id: string;
  version: number;
  status: 'pending' | 'in_progress' | 'success' | 'failed' | 'rolled_back';
  deploy_state: string;
  artifact_ref: string | null;
  artifact_kind: ArtifactKind;
  routing_status: 'active' | 'canary' | 'rollback' | 'archived';
  routing_weight: number;
  bundle_hash: string | null;
  bundle_size: number | null;
  provider: { name: DeploymentProviderName };
  target: ReturnType<typeof parseDeploymentTargetConfig>;
  deployed_by: string | null;
  deploy_message: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  resolved_endpoint?: { kind: string; base_url: string } | null;
};

const providerSchema = z.object({
  name: z.enum(['workers-dispatch', 'oci', 'ecs', 'cloud-run', 'k8s']),
}).strict();

const targetSchema = z.object({
  route_ref: z.string().min(1).optional(),
  endpoint: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('service-ref'),
      ref: z.string().min(1),
    }).strict(),
    z.object({
      kind: z.literal('http-url'),
      base_url: z.string().url(),
    }).strict(),
  ]).optional(),
  artifact: z.object({
    kind: z.enum(['worker-bundle', 'container-image']).optional(),
    image_ref: z.string().min(1).optional(),
    exposed_port: z.number().int().positive().optional(),
    health_path: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();

function extractResolvedEndpoint(providerStateJson: string): { kind: string; base_url: string } | null {
  const state = safeJsonParseOrDefault<Record<string, unknown>>(providerStateJson, {});
  const ep = state.resolved_endpoint;
  if (ep && typeof ep === 'object' && !Array.isArray(ep)) {
    const parsed = ep as Record<string, unknown>;
    if (typeof parsed.base_url === 'string' && parsed.base_url.length > 0) {
      return { kind: String(parsed.kind ?? 'http-url'), base_url: parsed.base_url };
    }
  }
  return null;
}

const workersDeployments = new Hono<AuthenticatedRouteEnv>()

.post('/:id/deployments',
  zValidator('json', z.object({
    bundle: z.string().optional(),
    deploy_message: z.string().optional(),
    strategy: z.enum(['direct', 'canary']).optional(),
    canary_weight: z.number().optional(),
    provider: providerSchema.optional(),
    target: targetSchema.optional(),
  }).strict()),
  async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);
  if (!worker) {
    throw new NotFoundError('Service');
  }
  const serviceId = worker.id;

  const body = c.req.valid('json') as {
    bundle?: string;
    deploy_message?: string;
    strategy?: 'direct' | 'canary';
    canary_weight?: number;
    provider?: z.infer<typeof providerSchema>;
    target?: z.infer<typeof targetSchema>;
  };

  const artifactKind: ArtifactKind = body.target?.artifact?.kind ?? 'worker-bundle';
  const isContainerDeploy = artifactKind === 'container-image';

  if (isContainerDeploy) {
    if (!body.target?.artifact?.image_ref) {
      throw new BadRequestError( 'artifact.image_ref is required for container-image deploys');
    }
    if (body.provider?.name === 'workers-dispatch') {
      throw new BadRequestError( 'workers-dispatch provider does not support container-image deploys');
    }
    if (body.strategy === 'canary') {
      throw new BadRequestError( 'canary strategy is not supported for container-image deploys');
    }
  } else {
    if (!body.bundle || typeof body.bundle !== 'string' || body.bundle.trim().length === 0) {
      throw new BadRequestError( 'bundle is required');
    }

    const bundleSizeBytes = new TextEncoder().encode(body.bundle).byteLength;
    if (bundleSizeBytes > MAX_BUNDLE_SIZE_BYTES) {
      throw new BadRequestError( `Bundle size (${Math.round(bundleSizeBytes / 1024 / 1024)}MB) exceeds maximum allowed size of 25MB`);
    }
  }

  const strategy = body.strategy ?? 'direct';

  const canaryWeight = typeof body.canary_weight === 'number' && Number.isFinite(body.canary_weight)
    ? Math.floor(body.canary_weight)
    : undefined;
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || undefined;

  const deploymentService = createDeploymentService(c.env);
  const deployment = await deploymentService.createDeployment({
    serviceId,
    spaceId: worker.space_id,
    userId: user.id,
    idempotencyKey,
    artifactKind,
    bundleContent: isContainerDeploy ? undefined : body.bundle,
    deployMessage: body.deploy_message,
    strategy,
    canaryWeight,
    provider: body.provider,
    target: body.target,
  });

  if (c.env.DEPLOY_QUEUE) {
    try {
      await c.env.DEPLOY_QUEUE.send({
        version: DEPLOYMENT_QUEUE_MESSAGE_VERSION,
        type: 'deployment',
        deploymentId: deployment.id,
        timestamp: Date.now(),
      });
    } catch (error) {
      logWarn('Queue enqueue failed, falling back to inline execution', { module: 'deployment', ...{
        deploymentId: deployment.id,
        error: error instanceof Error ? error.message : String(error),
      } });
      if (c.executionCtx) {
        c.executionCtx.waitUntil(deploymentService.executeDeployment(deployment.id));
      } else {
        await deploymentService.executeDeployment(deployment.id);
      }
    }
  } else {
    // Fallback for environments without queue binding
    c.executionCtx?.waitUntil(deploymentService.executeDeployment(deployment.id));
  }

  return c.json({
      deployment: {
        id: deployment.id,
        version: deployment.version,
        status: deployment.status,
        deploy_state: deployment.deploy_state,
        artifact_kind: deployment.artifact_kind,
        provider: { name: deployment.provider_name },
        target: parseDeploymentTargetConfig(deployment),
        routing_status: deployment.routing_status,
        routing_weight: deployment.routing_weight,
        created_at: deployment.created_at,
    },
  }, 201);
})

.get('/:id/deployments', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');
  const limit = parseLimit(c.req.query('limit'), 20, 50);

  const worker = await getServiceForUser(c.env.DB, workerId, user.id);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  const deploymentService = createDeploymentService(c.env);
  const deployments = await deploymentService.getDeploymentHistory(workerId, limit);

  const summaries: ApiDeploymentSummary[] = deployments.map((d) => {
    const summary: ApiDeploymentSummary = {
      id: d.id,
      version: d.version,
      status: d.status,
      deploy_state: d.deploy_state,
      artifact_ref: d.artifact_ref,
      artifact_kind: d.artifact_kind,
      routing_status: d.routing_status,
      routing_weight: d.routing_weight,
      bundle_hash: d.bundle_hash,
      bundle_size: d.bundle_size,
      provider: { name: d.provider_name },
      target: parseDeploymentTargetConfig(d),
      deployed_by: d.deployed_by,
      deploy_message: d.deploy_message,
      created_at: d.created_at,
      completed_at: d.completed_at,
      error_message: d.step_error,
    };
    if (d.artifact_kind === 'container-image') {
      summary.resolved_endpoint = extractResolvedEndpoint(d.provider_state_json);
    }
    return summary;
  });

  return c.json({ deployments: summaries });
})

.post('/:id/deployments/rollback',
  zValidator('json', z.object({
    target_version: z.number().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');

  const worker = await getServiceForUserWithRole(c.env.DB, workerId, user.id, ['owner', 'admin', 'editor']);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  const body = c.req.valid('json');
  const targetVersion = typeof body?.target_version === 'number' && Number.isFinite(body.target_version)
    ? Math.floor(body.target_version)
    : undefined;

  const deploymentService = createDeploymentService(c.env);

  const deployment = await deploymentService.rollback({ serviceId: worker.id, userId: user.id, targetVersion });
  return c.json({
    success: true,
    deployment: {
      id: deployment.id,
      version: deployment.version,
      artifact_kind: deployment.artifact_kind,
      provider: { name: deployment.provider_name },
      target: parseDeploymentTargetConfig(deployment),
      routing_status: deployment.routing_status,
      routing_weight: deployment.routing_weight,
    },
  });
})

.get('/:id/deployments/:deploymentId', async (c) => {
  const user = c.get('user');
  const workerId = c.req.param('id');
  const deploymentId = c.req.param('deploymentId');

  const worker = await getServiceForUser(c.env.DB, workerId, user.id);
  if (!worker) {
    throw new NotFoundError('Service');
  }

  const deploymentService = createDeploymentService(c.env);
  const deployment = await deploymentService.getDeploymentById(deploymentId);
  if (!deployment || deployment.service_id !== workerId) {
    throw new NotFoundError('Deployment');
  }

  const events = await deploymentService.getDeploymentEvents(deploymentId);
  const apiEvents: ApiDeploymentEvent[] = events.map((e) => ({
    id: String(e.id),
    type: e.event_type,
    message: e.message || '',
    created_at: e.created_at,
  }));

  let maskedEnvVars: Record<string, string> = {};
  try {
    maskedEnvVars = await deploymentService.getMaskedEnvVars(deployment);
  } catch (err) {
    logWarn('Failed to decrypt env vars for deployment', { module: 'deployment', details: [deploymentId, err] });
  }

  let bindings: WorkerBinding[] = [];
  try {
    bindings = await deploymentService.getBindings(deployment);
  } catch (err) {
    logWarn('Failed to decrypt bindings for deployment', { module: 'deployment', details: [deploymentId, err] });
  }

  const sanitizedBindings = bindings.map((b) => {
    if (b.type === 'secret_text') {
      return { ...b, text: '********' };
    }
    return b;
  });

  const resolvedEndpoint = deployment.artifact_kind === 'container-image'
    ? extractResolvedEndpoint(deployment.provider_state_json)
    : null;

  return c.json({
    deployment: {
      ...deployment,
      provider: { name: deployment.provider_name },
      target: parseDeploymentTargetConfig(deployment),
      error_message: deployment.step_error,
      env_vars_masked: maskedEnvVars,
      bindings: sanitizedBindings,
      ...(resolvedEndpoint ? { resolved_endpoint: resolvedEndpoint } : {}),
    },
    events: apiEvents,
  });
});

export default workersDeployments;
