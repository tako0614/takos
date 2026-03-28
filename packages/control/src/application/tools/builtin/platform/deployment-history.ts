import type { ToolDefinition, ToolHandler } from '../../types';
import { DeploymentService } from '../../../services/deployment/index';
import { getDb, services } from '../../../../infra/db';
import { eq, and } from 'drizzle-orm';
import type { WorkerBinding } from '../../../../platform/providers/cloudflare/wfp.ts';
import { safeJsonParseOrDefault } from '../../../../shared/utils';
import { logWarn } from '../../../../shared/utils/logger';

export const DEPLOYMENT_HISTORY: ToolDefinition = {
  name: 'deployment_history',
  description: 'List deployment history for a service.',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_id: {
        type: 'string',
        description: 'Service ID',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of deployments to return',
      },
    },
    required: ['service_id'],
  },
};

export const DEPLOYMENT_GET: ToolDefinition = {
  name: 'deployment_get',
  description: 'Get a deployment and its masked env/binding details.',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_id: {
        type: 'string',
        description: 'Service ID',
      },
      deployment_id: {
        type: 'string',
        description: 'Deployment ID',
      },
    },
    required: ['service_id', 'deployment_id'],
  },
};

export const DEPLOYMENT_ROLLBACK: ToolDefinition = {
  name: 'deployment_rollback',
  description: 'Rollback a service to the previous deployment or to a target version.',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_id: {
        type: 'string',
        description: 'Service ID',
      },
      target_version: {
        type: 'number',
        description: 'Optional deployment version to rollback to',
      },
    },
    required: ['service_id'],
  },
};

async function ensureServiceInWorkspace(serviceId: string, spaceId: string, d1: Parameters<ToolHandler>[1]['db']): Promise<void> {
  const db = getDb(d1);
  const worker = await db.select({ id: services.id })
    .from(services).where(and(eq(services.id, serviceId), eq(services.accountId, spaceId))).get();

  if (!worker) {
    throw new Error(`Service not found: ${serviceId}`);
  }
}

export const deploymentHistoryHandler: ToolHandler = async (args, context) => {
  const serviceId = String(args.service_id || '').trim();
  if (!serviceId) {
    throw new Error('service_id is required');
  }

  await ensureServiceInWorkspace(serviceId, context.spaceId, context.db);

  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.max(1, Math.min(50, Math.floor(args.limit)))
    : 20;

  const deploymentService = new DeploymentService(context.env);
  const deployments = await deploymentService.getDeploymentHistory(serviceId, limit);

  return JSON.stringify({
    deployments,
    count: deployments.length,
  }, null, 2);
};

export const deploymentGetHandler: ToolHandler = async (args, context) => {
  const serviceId = String(args.service_id || '').trim();
  const deploymentId = String(args.deployment_id || '').trim();

  if (!serviceId) {
    throw new Error('service_id is required');
  }
  if (!deploymentId) {
    throw new Error('deployment_id is required');
  }

  await ensureServiceInWorkspace(serviceId, context.spaceId, context.db);

  const deploymentService = new DeploymentService(context.env);
  const deployment = await deploymentService.getDeploymentById(deploymentId);
  if (!deployment || deployment.service_id !== serviceId) {
    throw new Error(`Deployment not found: ${deploymentId}`);
  }

  const events = await deploymentService.getDeploymentEvents(deploymentId);
  let maskedEnvVars: Record<string, string> = {};
  try {
    maskedEnvVars = await deploymentService.getMaskedEnvVars(deployment);
  } catch (error) {
    logWarn('Failed to load masked env vars', { module: 'deployment_get', error: error instanceof Error ? error.message : String(error) });
  }

  let bindings: WorkerBinding[] = [];
  try {
    bindings = await deploymentService.getBindings(deployment);
  } catch (error) {
    logWarn('Failed to load bindings', { module: 'deployment_get', error: error instanceof Error ? error.message : String(error) });
  }

  const sanitizedBindings = bindings.map((binding) => {
    if (binding.type === 'secret_text') {
      return { ...binding, text: '********' } as WorkerBinding;
    }
    return binding;
  });

  return JSON.stringify({
    deployment: {
      ...deployment,
      error_message: deployment.step_error,
      env_vars_masked: maskedEnvVars,
      bindings: sanitizedBindings,
    },
    events,
  }, null, 2);
};

export const deploymentRollbackHandler: ToolHandler = async (args, context) => {
  const serviceId = String(args.service_id || '').trim();
  if (!serviceId) {
    throw new Error('service_id is required');
  }

  await ensureServiceInWorkspace(serviceId, context.spaceId, context.db);

  const targetVersion = typeof args.target_version === 'number' && Number.isFinite(args.target_version)
    ? Math.floor(args.target_version)
    : undefined;

  const deploymentService = new DeploymentService(context.env);
  const deployment = await deploymentService.rollback({ serviceId, userId: context.userId, targetVersion });

  return JSON.stringify({
    success: true,
    deployment: {
      ...deployment,
    },
  }, null, 2);
};

export const DEPLOYMENT_HISTORY_TOOLS: ToolDefinition[] = [
  DEPLOYMENT_HISTORY,
  DEPLOYMENT_GET,
  DEPLOYMENT_ROLLBACK,
];

export const DEPLOYMENT_HISTORY_HANDLERS: Record<string, ToolHandler> = {
  deployment_history: deploymentHistoryHandler,
  deployment_get: deploymentGetHandler,
  deployment_rollback: deploymentRollbackHandler,
};
