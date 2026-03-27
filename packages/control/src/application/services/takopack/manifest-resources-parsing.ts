/**
 * Parsing and validation of Resource and Rollout objects from manifest YAML.
 */

import type { TakopackResourceObject, TakopackRolloutObject } from './types';
import { asRecord } from './manifest-utils';

// ---------------------------------------------------------------------------
// Parsed resource collection type
// ---------------------------------------------------------------------------

export interface ParsedResources {
  resourcesD1: Array<{ binding: string; migrations?: string }>;
  resourcesR2: Array<{ binding: string }>;
  resourcesKV: Array<{ binding: string }>;
  resourcesQueue: Array<{ binding: string; maxRetries?: number; deadLetterQueue?: string; deliveryDelaySeconds?: number }>;
  resourcesAnalyticsEngine: Array<{ binding: string; dataset?: string }>;
  resourcesWorkflow: Array<{ binding: string; service: string; export: string; timeoutMs?: number; maxRetries?: number }>;
  resourcesVectorize: Array<{ binding: string; dimensions?: number; metric?: 'cosine' | 'euclidean' | 'dot-product' }>;
  resourcesDurableObject: Array<{ binding: string; className: string; scriptName?: string }>;
}

// ---------------------------------------------------------------------------
// Resource parsing
// ---------------------------------------------------------------------------

export function parseResourceObjects(resourceObjects: TakopackResourceObject[]): ParsedResources {
  const resourcesD1: ParsedResources['resourcesD1'] = [];
  const resourcesR2: ParsedResources['resourcesR2'] = [];
  const resourcesKV: ParsedResources['resourcesKV'] = [];
  const resourcesQueue: ParsedResources['resourcesQueue'] = [];
  const resourcesAnalyticsEngine: ParsedResources['resourcesAnalyticsEngine'] = [];
  const resourcesWorkflow: ParsedResources['resourcesWorkflow'] = [];
  const resourcesVectorize: ParsedResources['resourcesVectorize'] = [];
  const resourcesDurableObject: ParsedResources['resourcesDurableObject'] = [];

  for (const resource of resourceObjects) {
    const type = String(resource.spec.type || '').trim();
    const binding = String(resource.spec.binding || resource.metadata.name || '').trim();

    if (!binding) {
      throw new Error(`Resource ${resource.metadata.name} is missing binding`);
    }

    if (type === 'd1') {
      const migrations = String(resource.spec.migrations || '').trim();
      resourcesD1.push({
        binding,
        ...(migrations ? { migrations } : {}),
      });
      continue;
    }

    if (type === 'r2') {
      resourcesR2.push({ binding });
      continue;
    }

    if (type === 'kv') {
      resourcesKV.push({ binding });
      continue;
    }

    if (type === 'queue') {
      const queue = asRecord(resource.spec.queue);
      const maxRetries = queue.maxRetries == null ? undefined : Number(queue.maxRetries);
      const deliveryDelaySeconds = queue.deliveryDelaySeconds == null ? undefined : Number(queue.deliveryDelaySeconds);
      const deadLetterQueue = queue.deadLetterQueue == null ? undefined : String(queue.deadLetterQueue).trim();
      if (maxRetries != null && (!Number.isFinite(maxRetries) || maxRetries < 0)) {
        throw new Error(`Resource ${resource.metadata.name} spec.queue.maxRetries must be a non-negative number`);
      }
      if (deliveryDelaySeconds != null && (!Number.isFinite(deliveryDelaySeconds) || deliveryDelaySeconds < 0)) {
        throw new Error(`Resource ${resource.metadata.name} spec.queue.deliveryDelaySeconds must be a non-negative number`);
      }
      resourcesQueue.push({
        binding,
        ...(maxRetries != null ? { maxRetries: Math.floor(maxRetries) } : {}),
        ...(deadLetterQueue ? { deadLetterQueue } : {}),
        ...(deliveryDelaySeconds != null ? { deliveryDelaySeconds: Math.floor(deliveryDelaySeconds) } : {}),
      });
      continue;
    }

    if (type === 'analyticsEngine') {
      const analyticsEngine = asRecord(resource.spec.analyticsEngine);
      const dataset = analyticsEngine.dataset == null ? undefined : String(analyticsEngine.dataset).trim();
      resourcesAnalyticsEngine.push({
        binding,
        ...(dataset ? { dataset } : {}),
      });
      continue;
    }

    if (type === 'workflow') {
      const workflow = asRecord(resource.spec.workflow);
      const service = String(workflow.service || '').trim();
      const exportName = String(workflow.export || '').trim();
      const timeoutMs = workflow.timeoutMs == null ? undefined : Number(workflow.timeoutMs);
      const maxRetries = workflow.maxRetries == null ? undefined : Number(workflow.maxRetries);
      if (!service) {
        throw new Error(`Resource ${resource.metadata.name} spec.workflow.service is required`);
      }
      if (!exportName) {
        throw new Error(`Resource ${resource.metadata.name} spec.workflow.export is required`);
      }
      if (timeoutMs != null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        throw new Error(`Resource ${resource.metadata.name} spec.workflow.timeoutMs must be a positive number`);
      }
      if (maxRetries != null && (!Number.isFinite(maxRetries) || maxRetries < 0)) {
        throw new Error(`Resource ${resource.metadata.name} spec.workflow.maxRetries must be a non-negative number`);
      }
      resourcesWorkflow.push({
        binding,
        service,
        export: exportName,
        ...(timeoutMs != null ? { timeoutMs: Math.floor(timeoutMs) } : {}),
        ...(maxRetries != null ? { maxRetries: Math.floor(maxRetries) } : {}),
      });
      continue;
    }

    if (type === 'vectorize') {
      const vectorize = asRecord(resource.spec.vectorize);
      const dimensions = vectorize.dimensions == null ? undefined : Number(vectorize.dimensions);
      const metric = vectorize.metric == null ? undefined : String(vectorize.metric).trim();
      if (dimensions != null && (!Number.isFinite(dimensions) || dimensions <= 0)) {
        throw new Error(`Resource ${resource.metadata.name} spec.vectorize.dimensions must be a positive number`);
      }
      if (metric != null && !['cosine', 'euclidean', 'dot-product'].includes(metric)) {
        throw new Error(`Resource ${resource.metadata.name} spec.vectorize.metric must be cosine/euclidean/dot-product`);
      }
      resourcesVectorize.push({
        binding,
        ...(dimensions != null ? { dimensions: Math.floor(dimensions) } : {}),
        ...(metric ? { metric: metric as 'cosine' | 'euclidean' | 'dot-product' } : {}),
      });
      continue;
    }

    if (type === 'durableObject') {
      const durableObject = asRecord(resource.spec.durableObject);
      const className = String(durableObject.className || '').trim();
      if (!className) {
        throw new Error(`Resource ${resource.metadata.name} spec.durableObject.className is required`);
      }
      const scriptName = durableObject.scriptName == null ? undefined : String(durableObject.scriptName).trim();
      resourcesDurableObject.push({
        binding,
        className,
        ...(scriptName ? { scriptName } : {}),
      });
      continue;
    }

    if (type === 'secretRef') {
      // secretRef resources are provisioned at deploy time (not materialized as CF bindings).
      // They generate tokens that are injected into worker env and MCP server auth.
      continue;
    }

    throw new Error(`Unsupported Resource.spec.type for ${resource.metadata.name}: ${type}`);
  }

  return {
    resourcesD1,
    resourcesR2,
    resourcesKV,
    resourcesQueue,
    resourcesAnalyticsEngine,
    resourcesWorkflow,
    resourcesVectorize,
    resourcesDurableObject,
  };
}

// ---------------------------------------------------------------------------
// Rollout spec
// ---------------------------------------------------------------------------

export function parseRolloutSpec(obj: TakopackRolloutObject): TakopackRolloutObject['spec'] {
  const spec = obj.spec as Record<string, unknown>;
  const strategy = spec.strategy === 'immediate' ? 'immediate' : 'staged';
  const autoPromote = spec.autoPromote !== false;

  const defaultStages = [
    { weight: 1, pauseMinutes: 5 },
    { weight: 5, pauseMinutes: 10 },
    { weight: 25, pauseMinutes: 15 },
    { weight: 50, pauseMinutes: 15 },
    { weight: 100, pauseMinutes: 0 },
  ];

  let stages: Array<{ weight: number; pauseMinutes: number }>;
  if (Array.isArray(spec.stages) && spec.stages.length > 0) {
    stages = spec.stages.map((s: unknown) => {
      const stage = s as Record<string, unknown>;
      const weight = Math.min(100, Math.max(1, Math.floor(Number(stage.weight) || 1)));
      const pauseMinutes = Math.max(0, Math.floor(Number(stage.pauseMinutes) || 0));
      return { weight, pauseMinutes };
    });
    // Ensure final stage is 100%
    if (stages[stages.length - 1].weight !== 100) {
      stages.push({ weight: 100, pauseMinutes: 0 });
    }
  } else {
    stages = defaultStages;
  }

  let healthCheck: { errorRateThreshold: number; minRequests: number } | undefined;
  if (spec.healthCheck && typeof spec.healthCheck === 'object') {
    const hc = spec.healthCheck as Record<string, unknown>;
    const errorRateThreshold = Math.min(1, Math.max(0, Number(hc.errorRateThreshold) || 0.05));
    const minRequests = Math.max(1, Math.floor(Number(hc.minRequests) || 100));
    healthCheck = { errorRateThreshold, minRequests };
  }

  return { strategy, stages, healthCheck, autoPromote };
}
