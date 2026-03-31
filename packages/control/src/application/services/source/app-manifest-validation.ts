import { parseWorkflow, validateWorkflow, type Workflow } from 'takos-actions-engine';
import { VECTORIZE_DEFAULT_DIMENSIONS } from '../../../shared/config/limits.ts';
import type { AppResource, AppWorker, ResourceLimits } from './app-manifest-types.ts';
import { toPublicResourceType } from '../resources/capabilities.ts';
import {
  asRecord,
  asString,
  asRequiredString,
  asOptionalInteger,
  normalizeRepoPath,
  filterWorkflowErrors,
} from './app-manifest-utils.ts';

/** Minimal service shape used by resource validation (supports both workers and containers) */
type ValidatableService = {
  type: 'worker' | 'container';
  bindings?: AppWorker['bindings'];
  triggers?: AppWorker['triggers'];
};

const SUPPORTED_PUBLIC_RESOURCE_TYPES = [
  'd1',
  'r2',
  'kv',
  'secretRef',
  'vectorize',
  'queue',
  'analyticsEngine',
  'workflow',
  'durableObject',
];

function resolveCanonicalResourceType(type: string): AppResource['type'] | null {
  const publicType = toPublicResourceType(type);
  if (!publicType) return null;
  if (!SUPPORTED_PUBLIC_RESOURCE_TYPES.includes(publicType)) {
    return null;
  }
  return publicType as AppResource['type'];
}

function getResourceSection(resource: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  for (const name of names) {
    const section = resource[name];
    if (section && typeof section === 'object') {
      return asRecord(section);
    }
  }
  return {};
}

export function parseAndValidateWorkflowYaml(raw: string, workflowPath: string): Workflow {
  const { workflow, diagnostics } = parseWorkflow(raw);
  const parseErrors = filterWorkflowErrors(diagnostics);
  if (parseErrors.length > 0) {
    throw new Error(`Workflow parse error (${workflowPath}): ${parseErrors.map((entry) => entry.message).join(', ')}`);
  }

  const validation = validateWorkflow(workflow);
  const validationErrors = filterWorkflowErrors(validation.diagnostics);
  if (validationErrors.length > 0) {
    throw new Error(`Workflow validation error (${workflowPath}): ${validationErrors.map((entry) => entry.message).join(', ')}`);
  }

  return workflow;
}

export function validateDeployProducerJob(workflow: Workflow, workflowPath: string, jobKey: string): void {
  const job = workflow.jobs[jobKey];
  if (!job) {
    throw new Error(`Workflow job not found in ${workflowPath}: ${jobKey}`);
  }
  if (job.needs) {
    throw new Error(`Deploy producer job must not use needs (${workflowPath}#${jobKey})`);
  }
  if (job.strategy) {
    throw new Error(`Deploy producer job must not use strategy.matrix (${workflowPath}#${jobKey})`);
  }
  if (job.services) {
    throw new Error(`Deploy producer job must not use services (${workflowPath}#${jobKey})`);
  }
}

export function parseResources(
  specRecord: Record<string, unknown>,
  services: Record<string, ValidatableService>,
): Record<string, AppResource> {
  const resourcesRecord = asRecord(specRecord.resources);
  const resources: Record<string, AppResource> = {};
  for (const [resourceName, resourceValue] of Object.entries(resourcesRecord)) {
    const resource = asRecord(resourceValue);
    const rawType = asRequiredString(resource.type, `spec.resources.${resourceName}.type`);
    const type = resolveCanonicalResourceType(rawType);
    if (!type) {
      throw new Error(`spec.resources.${resourceName}.type must be d1/r2/kv/secretRef/vectorize/queue/analyticsEngine/workflow/durableObject (or aliases: secret_ref, analytics_engine, workflow_binding, durable_object_namespace, sql, object_store, vector_index, analytics_store, workflow_runtime, durable_namespace, secret)`);
    }
    resources[resourceName] = {
      type,
      ...((() => { const v = asString(resource.binding, `spec.resources.${resourceName}.binding`); return v ? { binding: v } : {}; })()),
      ...(resource.generate === true ? { generate: true } : {}),
      ...(resource.migrations
        ? {
            migrations: typeof resource.migrations === 'string'
              ? normalizeRepoPath(asRequiredString(resource.migrations, `spec.resources.${resourceName}.migrations`))
              : {
                  up: normalizeRepoPath(asRequiredString(asRecord(resource.migrations).up, `spec.resources.${resourceName}.migrations.up`)),
                  down: normalizeRepoPath(asRequiredString(asRecord(resource.migrations).down, `spec.resources.${resourceName}.migrations.down`)),
                },
          }
        : {}),
      ...(type === 'vectorize'
        ? {
            vectorize: {
              dimensions: Number(asRecord(resource.vectorize).dimensions ?? VECTORIZE_DEFAULT_DIMENSIONS),
              metric: ((() => {
                const metric = String(asRecord(resource.vectorize).metric ?? 'cosine').trim();
                if (!['cosine', 'euclidean', 'dot-product'].includes(metric)) {
                  throw new Error(`spec.resources.${resourceName}.vectorize.metric must be cosine/euclidean/dot-product`);
                }
                return metric as 'cosine' | 'euclidean' | 'dot-product';
              })()),
            },
          }
        : {}),
      ...(type === 'queue'
        ? {
            queue: {
              ...(asOptionalInteger(asRecord(resource.queue).maxRetries, `spec.resources.${resourceName}.queue.maxRetries`, { min: 0 }) != null
                ? { maxRetries: asOptionalInteger(asRecord(resource.queue).maxRetries, `spec.resources.${resourceName}.queue.maxRetries`, { min: 0 }) }
                : {}),
              ...(asString(asRecord(resource.queue).deadLetterQueue, `spec.resources.${resourceName}.queue.deadLetterQueue`)
                ? { deadLetterQueue: asString(asRecord(resource.queue).deadLetterQueue, `spec.resources.${resourceName}.queue.deadLetterQueue`) }
                : {}),
              ...(asOptionalInteger(asRecord(resource.queue).deliveryDelaySeconds, `spec.resources.${resourceName}.queue.deliveryDelaySeconds`, { min: 0 }) != null
                ? { deliveryDelaySeconds: asOptionalInteger(asRecord(resource.queue).deliveryDelaySeconds, `spec.resources.${resourceName}.queue.deliveryDelaySeconds`, { min: 0 }) }
                : {}),
            },
          }
        : {}),
      ...(type === 'analyticsEngine'
        ? {
            analyticsEngine: {
              ...(asString(getResourceSection(resource, ['analyticsEngine', 'analyticsStore']).dataset, `spec.resources.${resourceName}.analyticsEngine.dataset`)
                ? { dataset: asString(getResourceSection(resource, ['analyticsEngine', 'analyticsStore']).dataset, `spec.resources.${resourceName}.analyticsEngine.dataset`) }
                : {}),
            },
          }
        : {}),
      ...(type === 'workflow'
        ? {
            workflow: {
              service: asRequiredString(getResourceSection(resource, ['workflow', 'workflowRuntime']).service, `spec.resources.${resourceName}.workflow.service`),
              export: asRequiredString(getResourceSection(resource, ['workflow', 'workflowRuntime']).export, `spec.resources.${resourceName}.workflow.export`),
              ...(asOptionalInteger(getResourceSection(resource, ['workflow', 'workflowRuntime']).timeoutMs, `spec.resources.${resourceName}.workflow.timeoutMs`, { min: 1 }) != null
                ? { timeoutMs: asOptionalInteger(getResourceSection(resource, ['workflow', 'workflowRuntime']).timeoutMs, `spec.resources.${resourceName}.workflow.timeoutMs`, { min: 1 }) }
                : {}),
              ...(asOptionalInteger(getResourceSection(resource, ['workflow', 'workflowRuntime']).maxRetries, `spec.resources.${resourceName}.workflow.maxRetries`, { min: 0 }) != null
                ? { maxRetries: asOptionalInteger(getResourceSection(resource, ['workflow', 'workflowRuntime']).maxRetries, `spec.resources.${resourceName}.workflow.maxRetries`, { min: 0 }) }
                : {}),
            },
          }
        : {}),
      ...(type === 'durableObject'
        ? {
            durableObject: {
              className: asRequiredString(getResourceSection(resource, ['durableObject', 'durableNamespace']).className, `spec.resources.${resourceName}.durableObject.className`),
              ...(asString(getResourceSection(resource, ['durableObject', 'durableNamespace']).scriptName, `spec.resources.${resourceName}.durableObject.scriptName`)
                ? { scriptName: asString(getResourceSection(resource, ['durableObject', 'durableNamespace']).scriptName, `spec.resources.${resourceName}.durableObject.scriptName`) }
                : {}),
            },
          }
        : {}),
      ...(((): { limits?: ResourceLimits } => {
        if (!resource.limits) return {};
        const limitsRecord = asRecord(resource.limits);
        const limits: ResourceLimits = {
          ...(limitsRecord.maxSizeMb != null ? { maxSizeMb: Number(limitsRecord.maxSizeMb) } : {}),
          ...(limitsRecord.maxRows != null ? { maxRows: Number(limitsRecord.maxRows) } : {}),
          ...(limitsRecord.maxKeys != null ? { maxKeys: Number(limitsRecord.maxKeys) } : {}),
        };
        return Object.keys(limits).length > 0 ? { limits } : {};
      })()),
    } as AppResource;
  }

  for (const [resourceName, resource] of Object.entries(resources)) {
    if (resource.type === 'queue' && resource.queue?.deadLetterQueue) {
      const deadLetterQueue = resources[resource.queue.deadLetterQueue];
      if (!deadLetterQueue || deadLetterQueue.type !== 'queue') {
        throw new Error(`spec.resources.${resourceName}.queue.deadLetterQueue must reference a queue resource`);
      }
    }
    if (resource.type === 'workflow' && resource.workflow && !services[resource.workflow.service]) {
      throw new Error(`spec.resources.${resourceName}.workflow.service references unknown service: ${resource.workflow.service}`);
    }
  }

  return resources;
}

export function validateResourceBindings(
  services: Record<string, ValidatableService>,
  resources: Record<string, AppResource>,
): void {
  for (const [serviceName, service] of Object.entries(services)) {
    if (service.type === 'container') continue;
    const bindingLists = service.bindings || {};
    for (const resourceName of bindingLists.d1 || []) {
      if (resources[resourceName]?.type !== 'd1') {
        throw new Error(`spec.workers.${serviceName}.bindings.d1 references unknown d1 resource: ${resourceName}`);
      }
    }
    for (const resourceName of bindingLists.r2 || []) {
      if (resources[resourceName]?.type !== 'r2') {
        throw new Error(`spec.workers.${serviceName}.bindings.r2 references unknown r2 resource: ${resourceName}`);
      }
    }
    for (const resourceName of bindingLists.kv || []) {
      if (resources[resourceName]?.type !== 'kv') {
        throw new Error(`spec.workers.${serviceName}.bindings.kv references unknown kv resource: ${resourceName}`);
      }
    }
    for (const resourceName of bindingLists.vectorize || []) {
      if (resources[resourceName]?.type !== 'vectorize') {
        throw new Error(`spec.workers.${serviceName}.bindings.vectorize references unknown vectorize resource: ${resourceName}`);
      }
    }
    for (const resourceName of bindingLists.queues || []) {
      if (resources[resourceName]?.type !== 'queue') {
        throw new Error(`spec.workers.${serviceName}.bindings.queues references unknown queue resource: ${resourceName}`);
      }
    }
    for (const resourceName of bindingLists.analytics || []) {
      if (resources[resourceName]?.type !== 'analyticsEngine') {
        throw new Error(`spec.workers.${serviceName}.bindings.analytics references unknown analyticsEngine resource: ${resourceName}`);
      }
    }
    for (const resourceName of bindingLists.workflows || []) {
      if (resources[resourceName]?.type !== 'workflow') {
        throw new Error(`spec.workers.${serviceName}.bindings.workflows references unknown workflow resource: ${resourceName}`);
      }
    }
    for (const resourceName of bindingLists.durableObjects || []) {
      if (resources[resourceName]?.type !== 'durableObject') {
        throw new Error(`spec.workers.${serviceName}.bindings.durableObjects references unknown durableObject resource: ${resourceName}`);
      }
    }
    for (const trigger of service.triggers?.queues || []) {
      if (resources[trigger.queue]?.type !== 'queue') {
        throw new Error(`spec.workers.${serviceName}.triggers.queues references unknown queue resource: ${trigger.queue}`);
      }
    }
  }
}
