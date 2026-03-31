/**
 * Group Deploy — binding result collectors.
 */
import type { BindingResult, ManifestWorkerDef } from './deploy-models.ts';

export function collectWorkerBindingResults(
  workerName: string,
  worker: ManifestWorkerDef,
  status: 'bound' | 'failed',
): BindingResult[] {
  const results: BindingResult[] = [];
  if (worker.bindings?.d1) {
    for (const r of worker.bindings.d1) results.push({ from: workerName, to: r, type: 'd1', status });
  }
  if (worker.bindings?.r2) {
    for (const r of worker.bindings.r2) results.push({ from: workerName, to: r, type: 'r2', status });
  }
  if (worker.bindings?.kv) {
    for (const r of worker.bindings.kv) results.push({ from: workerName, to: r, type: 'kv', status });
  }
  if (worker.bindings?.services) {
    for (const r of worker.bindings.services) results.push({ from: workerName, to: r, type: 'service', status });
  }
  return results;
}
