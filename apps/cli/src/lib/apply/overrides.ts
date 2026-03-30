/**
 * Override resolution — env-specific deep merge (no lodash).
 */

import type { AppManifest } from '../app-manifest.js';

// ---------------------------------------------------------------------------
// Overrides — env-specific deep merge
// ---------------------------------------------------------------------------

export function applyOverrides(manifest: AppManifest, env: string): AppManifest {
  const { overrides } = manifest.spec;

  if (!overrides?.[env]) return manifest;

  const envOverride = overrides[env];
  const mergedSpec = deepMerge(
    manifest.spec as unknown as Record<string, unknown>,
    envOverride,
  ) as AppManifest['spec'];

  // Remove the overrides key from the resolved spec — it has been consumed.
  delete (mergedSpec as { overrides?: unknown }).overrides;

  return { ...manifest, spec: mergedSpec };
}

export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(patch)) {
    const baseVal = base[key];
    const patchVal = patch[key];

    if (
      isPlainObject(baseVal) &&
      isPlainObject(patchVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        patchVal as Record<string, unknown>,
      );
    } else {
      result[key] = patchVal;
    }
  }

  return result;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
