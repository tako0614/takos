/**
 * Group Deploy — binding result collectors.
 */
import type { BindingResult, ManifestWorkerDef } from "./deploy-models.ts";

export function collectWorkerBindingResults(
  workerName: string,
  worker: ManifestWorkerDef,
  status: "bound" | "failed",
): BindingResult[] {
  const results: BindingResult[] = [];
  if (worker.bindings?.d1) {
    for (const r of worker.bindings.d1) {
      results.push({ from: workerName, to: r, type: "d1", status });
    }
  }
  if (worker.bindings?.r2) {
    for (const r of worker.bindings.r2) {
      results.push({ from: workerName, to: r, type: "r2", status });
    }
  }
  if (worker.bindings?.kv) {
    for (const r of worker.bindings.kv) {
      results.push({ from: workerName, to: r, type: "kv", status });
    }
  }
  if (worker.bindings?.queues) {
    for (const r of worker.bindings.queues) {
      results.push({ from: workerName, to: r, type: "queue", status });
    }
  }
  if (worker.bindings?.vectorize) {
    for (const r of worker.bindings.vectorize) {
      results.push({ from: workerName, to: r, type: "vectorize", status });
    }
  }
  if (worker.bindings?.analyticsEngine) {
    for (const r of worker.bindings.analyticsEngine) {
      results.push({
        from: workerName,
        to: r,
        type: "analyticsEngine",
        status,
      });
    }
  }
  if (worker.bindings?.workflow) {
    for (const r of worker.bindings.workflow) {
      results.push({ from: workerName, to: r, type: "workflow", status });
    }
  }
  if (worker.bindings?.durableObjects) {
    for (const r of worker.bindings.durableObjects) {
      results.push({ from: workerName, to: r, type: "durableObject", status });
    }
  }
  if (worker.bindings?.services) {
    for (const r of worker.bindings.services) {
      results.push({
        from: workerName,
        to: typeof r === "string" ? r : r.name,
        type: "service",
        status,
      });
    }
  }
  return results;
}
