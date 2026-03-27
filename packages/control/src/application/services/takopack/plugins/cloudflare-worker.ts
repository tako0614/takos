import type { ManifestWorkerConfig, TakopackWorkloadObject } from '../types';
import type {
  WorkloadPlugin,
  WorkloadPluginApplyContext,
  WorkloadPluginApplyResult,
  WorkloadPluginValidationContext,
} from './types';
import { normalizePackagePath } from '../manifest';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readStringArray(input: unknown, field: string): string[] {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error(`cloudflare.worker pluginConfig.${field} must be an array of strings`);
  }
  return input.map((entry) => {
    const value = String(entry || '').trim();
    if (!value) {
      throw new Error(`cloudflare.worker pluginConfig.${field} contains an empty value`);
    }
    return value;
  });
}

function readStringMap(input: unknown, field: string): Record<string, string> {
  if (input == null) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`cloudflare.worker pluginConfig.${field} must be an object`);
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const envKey = String(key || '').trim();
    if (!envKey) {
      throw new Error(`cloudflare.worker pluginConfig.${field} contains an empty key`);
    }
    out[envKey] = String(value ?? '');
  }
  return out;
}

function resolveArtifactRef(workload: TakopackWorkloadObject): string {
  const spec = workload.spec;
  const pluginConfig = asRecord(spec.pluginConfig);

  const raw = String(
    spec.artifactRef
      || pluginConfig.bundle
      || pluginConfig.bundlePath
      || ''
  ).trim();

  if (!raw) {
    throw new Error(`Workload ${workload.metadata.name} (${workload.spec.type}) is missing artifactRef`);
  }

  const normalized = normalizePackagePath(raw);
  if (!normalized) {
    throw new Error(`Workload ${workload.metadata.name} has an invalid artifactRef`);
  }

  return normalized;
}

function resolveWorkerName(workload: TakopackWorkloadObject): string {
  const pluginConfig = asRecord(workload.spec.pluginConfig);
  const name = String(pluginConfig.workerName || workload.metadata.name || '').trim();
  if (!name) {
    throw new Error(`Workload ${workload.metadata.name} is missing worker name`);
  }
  return name;
}

function buildWorkerFromWorkload(
  workload: TakopackWorkloadObject,
  context: WorkloadPluginApplyContext
): ManifestWorkerConfig {
  const pluginConfig = asRecord(workload.spec.pluginConfig);
  const bindingConfig = asRecord(pluginConfig.bindings);
  const artifactRef = resolveArtifactRef(workload);
  const bundle = context.files.get(artifactRef);

  if (!bundle) {
    throw new Error(`Workload ${workload.metadata.name} artifact not found: ${artifactRef}`);
  }

  const checksum = context.checksums.get(artifactRef);
  if (!checksum) {
    throw new Error(`Missing checksum for workload artifact: ${artifactRef}`);
  }

  const env = readStringMap(pluginConfig.env, 'env');
  const services = readStringArray(bindingConfig.services, 'bindings.services');

  const d1FromPlugin = readStringArray(bindingConfig.d1, 'bindings.d1');
  const r2FromPlugin = readStringArray(bindingConfig.r2, 'bindings.r2');
  const kvFromPlugin = readStringArray(bindingConfig.kv, 'bindings.kv');
  const queueFromPlugin = readStringArray(bindingConfig.queues, 'bindings.queues');
  const analyticsFromPlugin = readStringArray(bindingConfig.analytics, 'bindings.analytics');
  const workflowsFromPlugin = readStringArray(bindingConfig.workflows, 'bindings.workflows');
  const vectorizeFromPlugin = readStringArray(bindingConfig.vectorize, 'bindings.vectorize');
  const durableObjectsFromPlugin = readStringArray(bindingConfig.durableObjects, 'bindings.durableObjects');
  const triggers = asRecord(pluginConfig.triggers);
  const schedulesRaw = triggers.schedules;
  const queuesRaw = triggers.queues;
  const schedules = Array.isArray(schedulesRaw)
    ? schedulesRaw.map((entry, index) => {
        const record = asRecord(entry);
        const cron = String(record.cron || '').trim();
        const exportName = String(record.export || '').trim();
        if (!cron) {
          throw new Error(`cloudflare.worker pluginConfig.triggers.schedules[${index}].cron is required`);
        }
        if (!exportName) {
          throw new Error(`cloudflare.worker pluginConfig.triggers.schedules[${index}].export is required`);
        }
        return { cron, export: exportName };
      })
    : [];
  const queueTriggers = Array.isArray(queuesRaw)
    ? queuesRaw.map((entry, index) => {
        const record = asRecord(entry);
        const queue = String(record.queue || '').trim();
        const exportName = String(record.export || '').trim();
        if (!queue) {
          throw new Error(`cloudflare.worker pluginConfig.triggers.queues[${index}].queue is required`);
        }
        if (!exportName) {
          throw new Error(`cloudflare.worker pluginConfig.triggers.queues[${index}].export is required`);
        }
        return { queue, export: exportName };
      })
    : [];

  const d1 = Array.from(new Set([...d1FromPlugin, ...context.bindings.d1]));
  const r2 = Array.from(new Set([...r2FromPlugin, ...context.bindings.r2]));
  const kv = Array.from(new Set([...kvFromPlugin, ...context.bindings.kv]));
  const queue = Array.from(new Set([...queueFromPlugin, ...context.bindings.queue]));
  const analytics = Array.from(new Set([...analyticsFromPlugin, ...context.bindings.analyticsEngine]));
  const workflows = Array.from(new Set([...workflowsFromPlugin, ...context.bindings.workflow]));
  const vectorize = Array.from(new Set([...vectorizeFromPlugin, ...context.bindings.vectorize]));
  const durableObjects = Array.from(new Set([...durableObjectsFromPlugin, ...context.bindings.durableObject]));

  return {
    name: resolveWorkerName(workload),
    bundle: artifactRef,
    bundleHash: `sha256:${checksum}`,
    bundleSize: bundle.byteLength,
    bindings: {
      d1,
      r2,
      kv,
      ...(queue.length > 0 ? { queue } : {}),
      ...(analytics.length > 0 ? { analytics } : {}),
      ...(workflows.length > 0 ? { workflows } : {}),
      ...(vectorize.length > 0 ? { vectorize } : {}),
      ...(durableObjects.length > 0 ? { durableObjects } : {}),
      ...(services.length > 0 ? { services } : {}),
    },
    ...(schedules.length > 0 || queueTriggers.length > 0
      ? {
          triggers: {
            ...(schedules.length > 0 ? { schedules } : {}),
            ...(queueTriggers.length > 0 ? { queues: queueTriggers } : {}),
          },
        }
      : {}),
    env,
  };
}

function validateWorkload(
  workload: TakopackWorkloadObject,
  context: WorkloadPluginValidationContext
): void {
  const artifactRef = resolveArtifactRef(workload);

  if (!context.files.has(artifactRef)) {
    throw new Error(`Workload ${workload.metadata.name} artifact not found in package: ${artifactRef}`);
  }

  if (!context.checksums.has(artifactRef)) {
    throw new Error(`Workload ${workload.metadata.name} artifact checksum not found: ${artifactRef}`);
  }

  const pluginConfig = asRecord(workload.spec.pluginConfig);
  const bindingConfig = asRecord(pluginConfig.bindings);
  readStringArray(bindingConfig.d1, 'bindings.d1');
  readStringArray(bindingConfig.r2, 'bindings.r2');
  readStringArray(bindingConfig.kv, 'bindings.kv');
  readStringArray(bindingConfig.queues, 'bindings.queues');
  readStringArray(bindingConfig.analytics, 'bindings.analytics');
  readStringArray(bindingConfig.workflows, 'bindings.workflows');
  readStringArray(bindingConfig.vectorize, 'bindings.vectorize');
  readStringArray(bindingConfig.durableObjects, 'bindings.durableObjects');
  readStringArray(bindingConfig.services, 'bindings.services');
  readStringMap(pluginConfig.env, 'env');
  const triggers = asRecord(pluginConfig.triggers);
  if (triggers.schedules != null && !Array.isArray(triggers.schedules)) {
    throw new Error('cloudflare.worker pluginConfig.triggers.schedules must be an array');
  }
  if (triggers.queues != null && !Array.isArray(triggers.queues)) {
    throw new Error('cloudflare.worker pluginConfig.triggers.queues must be an array');
  }

  resolveWorkerName(workload);
}

export const cloudflareWorkerPlugin: WorkloadPlugin = {
  type: 'cloudflare.worker',
  validate(workload, context) {
    validateWorkload(workload, context);
  },
  apply(workload, context): WorkloadPluginApplyResult {
    const worker = buildWorkerFromWorkload(workload, context);
    return {
      runtime: 'cloudflare.worker',
      worker,
    };
  },
};
