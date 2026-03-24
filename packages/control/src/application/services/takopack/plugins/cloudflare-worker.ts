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

  const d1 = Array.from(new Set([...d1FromPlugin, ...context.bindings.d1]));
  const r2 = Array.from(new Set([...r2FromPlugin, ...context.bindings.r2]));
  const kv = Array.from(new Set([...kvFromPlugin, ...context.bindings.kv]));

  return {
    name: resolveWorkerName(workload),
    bundle: artifactRef,
    bundleHash: `sha256:${checksum}`,
    bundleSize: bundle.byteLength,
    bindings: {
      d1,
      r2,
      kv,
      ...(services.length > 0 ? { services } : {}),
    },
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
  readStringArray(bindingConfig.services, 'bindings.services');
  readStringMap(pluginConfig.env, 'env');

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
