/**
 * GCP project ID resolution helpers.
 *
 * The canonical env name is `GOOGLE_CLOUD_PROJECT` (matches the Google Cloud
 * SDK convention and Cloud Run's default env). `GCP_PROJECT_ID` is accepted as
 * an operator-local fallback and emits a one-time warning when it is the source
 * of the resolved value.
 *
 * Prefer `resolveGoogleCloudProject(env)` for typed `Env` consumers and
 * `resolveGoogleCloudProjectFromProcess()` for code that reads directly from
 * `Deno.env`.
 */

let warnedDeprecatedGcpProjectId = false;

function emitDeprecationWarning(): void {
  if (warnedDeprecatedGcpProjectId) return;
  warnedDeprecatedGcpProjectId = true;
  // `console.warn` so this surfaces even from contexts that do not have a
  // structured logger wired in (resolvers, registries).
  console.warn(
    "[takos] GCP_PROJECT_ID is deprecated; set GOOGLE_CLOUD_PROJECT instead. " +
      "The alternate name is still honored as a fallback but will be removed " +
      "in a future release.",
  );
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the GCP project ID from a typed env object.
 *
 * Reads `GOOGLE_CLOUD_PROJECT` first; falls back to the deprecated
 * `GCP_PROJECT_ID` and emits a one-time warning when the fallback is used.
 * Returns `undefined` when neither is set.
 */
export function resolveGoogleCloudProject(
  env: { GOOGLE_CLOUD_PROJECT?: string; GCP_PROJECT_ID?: string },
): string | undefined {
  const canonical = trimOrUndefined(env.GOOGLE_CLOUD_PROJECT);
  if (canonical) return canonical;
  const legacy = trimOrUndefined(env.GCP_PROJECT_ID);
  if (legacy) {
    emitDeprecationWarning();
    return legacy;
  }
  return undefined;
}

/**
 * Resolve the GCP project ID from `Deno.env`.
 *
 * Same precedence and warning semantics as {@link resolveGoogleCloudProject}.
 */
export function resolveGoogleCloudProjectFromProcess(): string | undefined {
  const canonical = trimOrUndefined(Deno.env.get("GOOGLE_CLOUD_PROJECT"));
  if (canonical) return canonical;
  const legacy = trimOrUndefined(Deno.env.get("GCP_PROJECT_ID"));
  if (legacy) {
    emitDeprecationWarning();
    return legacy;
  }
  return undefined;
}

/**
 * Test-only helper to reset the one-time deprecation warning latch.
 * Not exported via the platform index — import directly from this module
 * when needed.
 */
export function _resetGoogleCloudProjectDeprecationWarningForTests(): void {
  warnedDeprecatedGcpProjectId = false;
}
