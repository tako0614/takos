import type {
  AppContainer,
  AppWorker,
  AppService,
  EnvironmentOverrides,
} from '../app-manifest-types.ts';
import { asRecord, asStringMap, normalizeRepoPath } from '../app-manifest-utils.ts';

// ============================================================
// Partial container/worker/service parsers (for environment overrides)
// ============================================================

function parsePartialContainers(raw: unknown): Record<string, Partial<AppContainer>> {
  const containersRecord = asRecord(raw);
  const result: Record<string, Partial<AppContainer>> = {};
  for (const [name, value] of Object.entries(containersRecord)) {
    const c = asRecord(value);
    result[name] = {
      ...(c.dockerfile ? { dockerfile: normalizeRepoPath(String(c.dockerfile)) } : {}),
      ...(c.port != null ? { port: Number(c.port) } : {}),
      ...(c.instanceType ? { instanceType: String(c.instanceType) } : {}),
      ...(c.maxInstances != null ? { maxInstances: Number(c.maxInstances) } : {}),
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(c.env, `overrides.containers.${name}.env`); return v ? { env: v } : {}; })()),
    };
  }
  return result;
}

function parsePartialWorkers(raw: unknown): Record<string, Partial<AppWorker>> {
  const workersRecord = asRecord(raw);
  const result: Record<string, Partial<AppWorker>> = {};
  for (const [name, value] of Object.entries(workersRecord)) {
    const w = asRecord(value);
    result[name] = {
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(w.env, `overrides.workers.${name}.env`); return v ? { env: v } : {}; })()),
    };
  }
  return result;
}

function parsePartialServices(raw: unknown): Record<string, Partial<AppService>> {
  const servicesRecord = asRecord(raw);
  const result: Record<string, Partial<AppService>> = {};
  for (const [name, value] of Object.entries(servicesRecord)) {
    const s = asRecord(value);
    result[name] = {
      ...(s.dockerfile ? { dockerfile: normalizeRepoPath(String(s.dockerfile)) } : {}),
      ...(s.port != null ? { port: Number(s.port) } : {}),
      ...(s.instanceType ? { instanceType: String(s.instanceType) } : {}),
      ...(s.maxInstances != null ? { maxInstances: Number(s.maxInstances) } : {}),
      ...(s.ipv4 === true ? { ipv4: true } : {}),
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(s.env, `overrides.services.${name}.env`); return v ? { env: v } : {}; })()),
    };
  }
  return result;
}

// ============================================================
// Overrides parser
// ============================================================

export function parseOverrides(specRecord: Record<string, unknown>): EnvironmentOverrides | undefined {
  const raw = specRecord.overrides;
  if (!raw) return undefined;
  const record = asRecord(raw);
  const result: EnvironmentOverrides = {};
  for (const [envName, envOverrides] of Object.entries(record)) {
    const envRecord = asRecord(envOverrides);
    result[envName] = {
      ...(envRecord.containers ? { containers: parsePartialContainers(envRecord.containers) } : {}),
      ...(envRecord.workers ? { workers: parsePartialWorkers(envRecord.workers) } : {}),
      ...(envRecord.services ? { services: parsePartialServices(envRecord.services) } : {}),
    };
  }
  return result;
}
