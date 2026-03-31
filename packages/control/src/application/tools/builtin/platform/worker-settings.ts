import type { ToolDefinition, ToolHandler } from '../../tool-definitions.ts';
import { createCommonEnvDeps } from '../../../services/common-env/index.ts';
import { DeploymentService } from '../../../services/deployment/index.ts';
import { ServiceDesiredStateService } from '../../../services/platform/worker-desired-state.ts';
import { normalizeCommonEnvName } from '../../../services/common-env/crypto.ts';
import { getDb, resourceAccess, resources, serviceDeployments } from '../../../../infra/db/index.ts';
import { and, eq, or } from 'drizzle-orm';
import { resolveServiceReferenceRecord } from '../../../services/platform/workers.ts';
import { toResourceCapability } from '../../../services/resources/capabilities.ts';
// Inline helper: extract resource config as a Record (replaces removed getBindingConfigForResource).
function getBindingConfigForResource(resource: { config: string }): Record<string, unknown> | null {
  if (!resource.config) return null;
  try {
    const parsed = typeof resource.config === 'string' ? JSON.parse(resource.config) : resource.config;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

const MUTATION_ERROR = 'Deployment artifacts are immutable. Update the service slot settings and create a new deployment instead.';

type WorkerRef =
  | { kind: 'worker'; workerId: string; spaceId: string }
  | { kind: 'deployment'; workerId: string; spaceId: string; deploymentId: string };

async function resolveWorkerRef(workerIdentifier: string, context: Parameters<ToolHandler>[1]): Promise<WorkerRef> {
  const db = getDb(context.db);

  const workerRow = await resolveServiceReferenceRecord(context.db, context.spaceId, workerIdentifier);

  if (workerRow) {
    return {
      kind: 'worker',
      workerId: workerRow.id,
      spaceId: workerRow.accountId,
    };
  }

  const deploymentRow = await db.select({
    id: serviceDeployments.id,
    workerId: serviceDeployments.serviceId,
    accountId: serviceDeployments.accountId,
  })
    .from(serviceDeployments)
    .where(and(eq(serviceDeployments.accountId, context.spaceId), eq(serviceDeployments.artifactRef, workerIdentifier)))
    .get();

  if (deploymentRow) {
    return {
      kind: 'deployment',
      workerId: deploymentRow.workerId,
      spaceId: deploymentRow.accountId,
      deploymentId: deploymentRow.id,
    };
  }

  throw new Error(`Service not found: ${workerIdentifier}`);
}

function describeLocalEnv(envVars: Array<{ name: string; type: 'plain_text' | 'secret_text' }>, workerIdentifier: string): string {
  if (envVars.length === 0) {
    return `No environment variables found for service: ${workerIdentifier}`;
  }

  const lines = envVars.map((variable) => {
    const icon = variable.type === 'secret_text' ? '🔒' : '📝';
    return `${icon} ${variable.name} (${variable.type})`;
  });

  return `Environment variables for ${workerIdentifier}:\n${lines.join('\n')}`;
}

function describeBindings(
  bindings: Array<{ type: string; name: string; resource_id?: string; resource_name?: string | null }>,
  workerIdentifier: string
): string {
  if (bindings.length === 0) {
    return `No resource bindings found for service: ${workerIdentifier}`;
  }

  const lines = bindings.map((binding) => `${toPublicBindingType(binding.type)}: ${binding.name} -> ${binding.resource_name || binding.resource_id || '-'}`);
  return `Resource bindings for ${workerIdentifier}:\n${lines.join('\n')}`;
}

function toCanonicalBindingType(bindingType: string): string {
  switch (bindingType) {
    case 'sql':
    case 'd1':
      return 'sql';
    case 'object_store':
    case 'r2':
    case 'r2_bucket':
      return 'object_store';
    case 'kv':
    case 'kv_namespace':
      return 'kv';
    case 'vector_index':
    case 'vectorize':
      return 'vector_index';
    case 'analytics_store':
    case 'analytics_engine':
    case 'analyticsEngine':
      return 'analytics_store';
    case 'workflow_runtime':
    case 'workflow':
    case 'workflow_binding':
      return 'workflow_runtime';
    case 'durable_namespace':
    case 'durable_object_namespace':
    case 'durableObject':
      return 'durable_namespace';
    case 'secret':
    case 'secretRef':
    case 'secret_ref':
      return 'secret';
    default:
      return bindingType;
  }
}

function toPublicBindingType(bindingType: string): string {
  switch (toCanonicalBindingType(bindingType)) {
    case 'sql':
      return 'd1';
    case 'object_store':
      return 'r2';
    case 'kv':
      return 'kv';
    case 'queue':
      return 'queue';
    case 'vector_index':
      return 'vectorize';
    case 'analytics_store':
      return 'analyticsEngine';
    case 'workflow_runtime':
      return 'workflow';
    case 'durable_namespace':
      return 'durableObject';
    case 'secret':
      return 'secretRef';
    default:
      return bindingType;
  }
}

function describeRuntimeConfig(
  runtimeConfig: {
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  },
  workerIdentifier: string
): string {
  let output = `Runtime configuration for service ${workerIdentifier}:\n`;
  output += `Compatibility Date: ${runtimeConfig.compatibility_date || 'not set'}\n`;
  output += `Compatibility Flags: ${runtimeConfig.compatibility_flags?.join(', ') || 'none'}\n`;
  output += `CPU Limit: ${runtimeConfig.limits?.cpu_ms || 'default'} ms`;
  return output;
}

async function resolveResourceIdByHandle(
  context: Parameters<ToolHandler>[1],
  handle: string
): Promise<{ id: string; type: string; name: string; providerResourceName: string | null; config: string }> {
  const db = getDb(context.db);

  // Try direct ownership first
  const ownedResource = await db.select({
    id: resources.id,
    type: resources.type,
    name: resources.name,
    providerResourceName: resources.providerResourceName,
    config: resources.config,
  })
    .from(resources)
    .where(and(
      eq(resources.status, 'active'),
      eq(resources.accountId, context.spaceId),
      or(
        eq(resources.id, handle),
        eq(resources.providerResourceId, handle),
        eq(resources.providerResourceName, handle),
        eq(resources.name, handle),
      ),
    )).get();

  if (ownedResource) return ownedResource;

  // Try via resource access
  const sharedResource = await db.select({
    id: resources.id,
    type: resources.type,
    name: resources.name,
    providerResourceName: resources.providerResourceName,
    config: resources.config,
  })
    .from(resources)
    .innerJoin(resourceAccess, eq(resources.id, resourceAccess.resourceId))
    .where(and(
      eq(resources.status, 'active'),
      eq(resourceAccess.accountId, context.spaceId),
      or(
        eq(resources.id, handle),
        eq(resources.providerResourceId, handle),
        eq(resources.providerResourceName, handle),
        eq(resources.name, handle),
      ),
    )).get();

  if (sharedResource) return sharedResource;

  throw new Error(`Resource not found: ${handle}`);
}

export const WORKER_ENV_GET: ToolDefinition = {
  name: 'service_env_get',
  description: 'Get environment variables for a service slot or deployment artifact',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_name: {
        type: 'string',
        description: 'Stable service slot name or deployment artifact ref',
      },
    },
    required: ['service_name'],
  },
};

export const WORKER_ENV_SET: ToolDefinition = {
  name: 'service_env_set',
  description: 'Replace environment variables for a service slot. Applies on the next deployment.',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_name: {
        type: 'string',
        description: 'Stable service slot name',
      },
      env: {
        type: 'array',
        description: 'Environment variables to set',
        items: {
          type: 'object',
          description: 'Environment variable',
          properties: {
            name: { type: 'string', description: 'Variable name (e.g., API_KEY)' },
            value: { type: 'string', description: 'Variable value' },
            type: { type: 'string', description: 'Type: plain_text or secret_text', enum: ['plain_text', 'secret_text'] },
          },
          required: ['name', 'value'],
        },
      },
    },
    required: ['service_name', 'env'],
  },
};

export const WORKER_BINDINGS_GET: ToolDefinition = {
  name: 'service_bindings_get',
  description: 'Get resource bindings for a service slot or deployment artifact',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_name: {
        type: 'string',
        description: 'Stable service slot name or deployment artifact ref',
      },
    },
    required: ['service_name'],
  },
};

export const WORKER_BINDINGS_SET: ToolDefinition = {
  name: 'service_bindings_set',
  description: 'Replace resource bindings for a service slot. Applies on the next deployment.',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_name: {
        type: 'string',
        description: 'Stable service slot name',
      },
      bindings: {
        type: 'array',
        description: 'Resource bindings to set',
        items: {
          type: 'object',
          description: 'Resource binding',
          properties: {
            type: {
              type: 'string',
              description: 'Binding type: d1, r2, kv, queue, vectorize, analyticsEngine, workflow, durableObject, service',
              enum: ['d1', 'r2', 'kv', 'queue', 'vectorize', 'analyticsEngine', 'workflow', 'durableObject', 'service'],
            },
            name: { type: 'string', description: 'Binding name in code (e.g., DB, STORAGE)' },
            id: { type: 'string', description: 'Resource handle (resource id, provider_resource_id, provider_resource_name, or resource name)' },
          },
          required: ['type', 'name', 'id'],
        },
      },
    },
    required: ['service_name', 'bindings'],
  },
};

export const WORKER_RUNTIME_GET: ToolDefinition = {
  name: 'service_runtime_get',
  description: 'Get runtime configuration for a service slot or deployment artifact',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_name: {
        type: 'string',
        description: 'Stable service slot name or deployment artifact ref',
      },
    },
    required: ['service_name'],
  },
};

export const WORKER_RUNTIME_SET: ToolDefinition = {
  name: 'service_runtime_set',
  description: 'Set runtime configuration for a service slot. Applies on the next deployment.',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_name: {
        type: 'string',
        description: 'Stable service slot name',
      },
      compatibility_date: {
        type: 'string',
        description: 'Compatibility date (e.g., 2024-01-01)',
      },
      compatibility_flags: {
        type: 'array',
        description: 'Compatibility flags (e.g., nodejs_compat)',
        items: { type: 'string', description: 'Flag name' },
      },
      cpu_ms: {
        type: 'number',
        description: 'CPU time limit in milliseconds (10-30000)',
      },
    },
    required: ['service_name'],
  },
};

export const workerEnvGetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === 'worker') {
    const desiredState = new ServiceDesiredStateService(context.env);
    const envVars = await desiredState.listLocalEnvVarSummaries(ref.spaceId, ref.workerId);
    return describeLocalEnv(envVars, workerIdentifier);
  }

  const deploymentService = new DeploymentService(context.env);
  const deployment = await deploymentService.getDeploymentById(ref.deploymentId);
  if (!deployment) {
    throw new Error(`Deployment not found for artifact: ${workerIdentifier}`);
  }
  const bindings = await deploymentService.getBindings(deployment);
  const envVars = bindings
    .filter((binding): binding is typeof binding & { type: 'plain_text' | 'secret_text' } => (
      binding.type === 'plain_text' || binding.type === 'secret_text'
    ))
    .map((binding) => ({ name: binding.name, type: binding.type }));
  return describeLocalEnv(envVars, workerIdentifier);
};

export const workerEnvSetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const envList = args.env as Array<{ name: string; value: string; type?: string }>;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === 'deployment') {
    throw new Error(MUTATION_ERROR);
  }

  const desiredState = new ServiceDesiredStateService(context.env);
  await desiredState.replaceLocalEnvVars({
    spaceId: ref.spaceId,
    workerId: ref.workerId,
    variables: envList.map((entry) => ({
      name: normalizeCommonEnvName(entry.name) ?? entry.name,
      value: entry.value,
      secret: entry.type === 'secret_text',
    })),
  });

  const deps = createCommonEnvDeps(context.env);
  await deps.reconciler.reconcileServiceCommonEnv(ref.spaceId, ref.workerId, {
    trigger: 'worker_env_patch',
  });

  return `Saved ${envList.length} environment variable(s) for service slot: ${workerIdentifier}. Applies on the next deployment.`;
};

export const workerBindingsGetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === 'worker') {
    const desiredState = new ServiceDesiredStateService(context.env);
    const bindings = await desiredState.listResourceBindings(ref.workerId);
    return describeBindings(bindings, workerIdentifier);
  }

  const deploymentService = new DeploymentService(context.env);
  const deployment = await deploymentService.getDeploymentById(ref.deploymentId);
  if (!deployment) {
    throw new Error(`Deployment not found for artifact: ${workerIdentifier}`);
  }
  const bindings = await deploymentService.getBindings(deployment);
  const resourceBindings = bindings
    .filter((binding) => binding.type !== 'plain_text' && binding.type !== 'secret_text')
    .map((binding) => ({
      type: toCanonicalBindingType(binding.type),
      name: binding.name,
      resource_name: binding.service
        || binding.database_id
        || binding.bucket_name
        || binding.namespace_id
        || binding.queue_name
        || binding.dataset
        || binding.workflow_name
        || null,
    }));
  return describeBindings(resourceBindings, workerIdentifier);
};

export const workerBindingsSetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const bindingsList = args.bindings as Array<{ type: string; name: string; id: string }>;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === 'deployment') {
    throw new Error(MUTATION_ERROR);
  }

  const nextBindings: Array<{ name: string; type: string; resourceId: string; config?: Record<string, unknown> }> = [];
  for (const binding of bindingsList) {
    const resource = await resolveResourceIdByHandle(context, binding.id);
    const capability = toResourceCapability(resource.type);
    const bindingConfig = getBindingConfigForResource(resource);
    let bindingType: string;
    switch (capability ?? resource.type) {
      case 'sql':
      case 'object_store':
      case 'kv':
      case 'queue':
      case 'vector_index':
      case 'analytics_store':
      case 'workflow_runtime':
      case 'durable_namespace':
        bindingType = capability ?? resource.type;
        break;
      case 'worker':
        bindingType = 'service';
        break;
      default:
        throw new Error(`Unsupported binding resource type: ${resource.type}`);
    }
    nextBindings.push({
      name: binding.name,
      type: bindingType,
      resourceId: resource.id,
      ...(bindingConfig ? { config: bindingConfig } : {}),
    });
  }

  const desiredState = new ServiceDesiredStateService(context.env);
  await desiredState.replaceResourceBindings({
    workerId: ref.workerId,
    bindings: nextBindings as Parameters<typeof desiredState.replaceResourceBindings>[0]['bindings'],
  });

  return `Saved ${bindingsList.length} resource binding(s) for service slot: ${workerIdentifier}. Applies on the next deployment.`;
};

export const workerRuntimeGetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === 'worker') {
    const desiredState = new ServiceDesiredStateService(context.env);
    const runtimeConfig = await desiredState.getRuntimeConfig(ref.spaceId, ref.workerId);
    return describeRuntimeConfig(runtimeConfig, workerIdentifier);
  }

  const deploymentService = new DeploymentService(context.env);
  const deployment = await deploymentService.getDeploymentById(ref.deploymentId);
  if (!deployment) {
    throw new Error(`Deployment not found for artifact: ${workerIdentifier}`);
  }
  const runtimeConfig = safeJsonParseRuntimeConfig(deployment.runtime_config_snapshot_json);
  return describeRuntimeConfig(runtimeConfig, workerIdentifier);
};

function safeJsonParseRuntimeConfig(raw: string | null | undefined): {
  compatibility_date?: string;
  compatibility_flags?: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
} {
  try {
    return raw ? JSON.parse(raw) as {
      compatibility_date?: string;
      compatibility_flags?: string[];
      limits?: { cpu_ms?: number; subrequests?: number };
    } : {};
  } catch {
    return {};
  }
}

export const workerRuntimeSetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const compatibilityDate = args.compatibility_date as string | undefined;
  const compatibilityFlags = args.compatibility_flags as string[] | undefined;
  const cpuMs = args.cpu_ms as number | undefined;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === 'deployment') {
    throw new Error(MUTATION_ERROR);
  }

  const desiredState = new ServiceDesiredStateService(context.env);
  await desiredState.saveRuntimeConfig({
    spaceId: ref.spaceId,
    workerId: ref.workerId,
    compatibilityDate,
    compatibilityFlags,
    limits: cpuMs ? { cpu_ms: cpuMs } : undefined,
  });

  return `Updated runtime configuration for service slot: ${workerIdentifier}. Applies on the next deployment.`;
};

export const WORKER_SETTINGS_TOOLS: ToolDefinition[] = [
  WORKER_ENV_GET,
  WORKER_ENV_SET,
  WORKER_BINDINGS_GET,
  WORKER_BINDINGS_SET,
  WORKER_RUNTIME_GET,
  WORKER_RUNTIME_SET,
];

export const WORKER_SETTINGS_HANDLERS: Record<string, ToolHandler> = {
  service_env_get: workerEnvGetHandler,
  service_env_set: workerEnvSetHandler,
  service_bindings_get: workerBindingsGetHandler,
  service_bindings_set: workerBindingsSetHandler,
  service_runtime_get: workerRuntimeGetHandler,
  service_runtime_set: workerRuntimeSetHandler,
};
