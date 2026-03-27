/**
 * Binding resolution — maps Resource + Binding objects to per-workload binding sets.
 */

import type {
  TakopackBindingObject,
  TakopackResourceObject,
  TakopackWorkloadObject,
} from './types';
import { asRecord } from './manifest-utils';

export type ResolvedBindings = {
  d1: string[];
  r2: string[];
  kv: string[];
  queue: string[];
  analyticsEngine: string[];
  workflow: string[];
  vectorize: string[];
  durableObject: string[];
};

export function buildBindingLookup(
  resources: TakopackResourceObject[],
  workloads: TakopackWorkloadObject[],
  bindings: TakopackBindingObject[]
): Map<string, ResolvedBindings> {
  const resourcesByName = new Map(resources.map((resource) => [resource.metadata.name, resource]));
  const workloadsByName = new Map(workloads.map((workload) => [workload.metadata.name, workload]));
  const out = new Map<string, ResolvedBindings>();

  for (const workload of workloads) {
    out.set(workload.metadata.name, {
      d1: [],
      r2: [],
      kv: [],
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
    });
  }

  for (const binding of bindings) {
    const from = String(binding.spec.from || '').trim();
    const to = String(binding.spec.to || '').trim();
    if (!from || !to) {
      throw new Error(`Binding ${binding.metadata.name} must include spec.from and spec.to`);
    }

    const resource = resourcesByName.get(from);
    if (!resource) {
      throw new Error(`Binding ${binding.metadata.name} references missing Resource: ${from}`);
    }

    const workload = workloadsByName.get(to);
    if (!workload) {
      throw new Error(`Binding ${binding.metadata.name} references missing Workload: ${to}`);
    }

    const type = String(resource.spec.type || '').trim();
    if (type !== 'd1' && type !== 'r2' && type !== 'kv' && type !== 'queue' && type !== 'analyticsEngine' && type !== 'workflow' && type !== 'vectorize' && type !== 'durableObject') {
      throw new Error(`Binding ${binding.metadata.name} references unsupported resource type: ${type}`);
    }

    const mount = asRecord(binding.spec.mount);
    const mountType = String(mount.type || '').trim();
    if (mountType && mountType !== type) {
      throw new Error(
        `Binding ${binding.metadata.name} mount.type (${mountType}) does not match Resource type (${type})`
      );
    }

    const defaultBinding = String(resource.spec.binding || resource.metadata.name || '').trim();
    const bindingName = String(mount.as || defaultBinding).trim();
    if (!bindingName) {
      throw new Error(`Binding ${binding.metadata.name} resolved to empty binding name`);
    }

    const resolved = out.get(workload.metadata.name);
    if (!resolved) {
      throw new Error(`Binding ${binding.metadata.name} references unresolved workload bindings`);
    }

    const target = resolved[type as 'd1' | 'r2' | 'kv' | 'queue' | 'analyticsEngine' | 'workflow' | 'vectorize' | 'durableObject'];
    if (!target.includes(bindingName)) {
      target.push(bindingName);
    }
  }

  return out;
}
