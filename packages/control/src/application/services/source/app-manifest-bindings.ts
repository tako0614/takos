// ============================================================
// app-manifest-bindings.ts
// ============================================================
//
// Historical helper that parsed explicit per-workload `bindings` blocks
// from the retired Kubernetes-envelope manifest schema.
//
// Public manifests now use the flat `publish + consume` contract. This
// module only remains as compatibility glue for older deploy pipeline
// code that still imports "bindings" helpers during the migration.
// ============================================================

import type { AppStorage, StorageType } from "./app-manifest-types.ts";

/**
 * Legacy stub type kept so the deploy pipeline can refer to "bindings"
 * without pulling in Cloudflare-specific type names. In the flat schema
 * there are no per-workload binding records, so this shape intentionally
 * has no fields.
 */
export type AppWorkloadBindings = Record<string, never>;

/**
 * Legacy stub type kept so older parsers can reference `ServiceBinding`.
 * In the flat schema inter-service wiring is implicit (compute entries
 * reference each other by name), so the only thing a caller can read from
 * here is the canonical name string.
 */
export type ServiceBinding = string | { name: string; version?: string };

/**
 * Legacy alias retained for callers that still reference
 * `AppResourceType`. Maps directly to the canonical flat-schema
 * storage type.
 */
export type AppResourceType = StorageType;

/**
 * Legacy parser stub. The envelope schema exposed an explicit
 * `{ services: [...] }` array on each workload; the flat schema retired
 * this in favor of implicit compute-to-compute references. Callers
 * should not invoke this anymore; the stub returns `undefined`.
 */
export function parseServiceBindingList(
  _raw: unknown,
  _prefix: string,
): ServiceBinding[] | undefined {
  return undefined;
}

/**
 * Legacy parser stub. See `parseServiceBindingList`.
 */
export function parseWorkloadBindings(
  _raw: unknown,
  _prefix: string,
): AppWorkloadBindings | undefined {
  return undefined;
}

/**
 * Legacy descriptor helper. Public manifests no longer describe storage
 * wiring here; bindings are resolved through provider-backed
 * `publish + consume` data instead. This stub returns an empty list so
 * legacy callers short-circuit cleanly.
 */
export function getWorkloadResourceBindingDescriptors(
  _bindings?: AppWorkloadBindings,
): Array<
  {
    resourceName: string;
    key: string;
    resourceType?: AppResourceType;
  }
> {
  return [];
}

/**
 * Legacy helper that returned the named services a workload depends on.
 * The flat schema tracks this via the `compute.<name>.depends` field —
 * callers should use that instead. This stub returns an empty list.
 */
export function getWorkloadServiceBindingTargets(
  _bindings?: AppWorkloadBindings,
): string[] {
  return [];
}

// Re-export so callers still resolve `AppStorage` through this module.
export type { AppStorage };
