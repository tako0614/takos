import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
/**
 * GCP project ID resolution helpers.
 *
 * The canonical env name is `GOOGLE_CLOUD_PROJECT`, matching the Google Cloud
 * SDK convention and Cloud Run's default env.
 *
 * Prefer `resolveGoogleCloudProject(env)` for typed `Env` consumers and
 * `resolveGoogleCloudProjectFromProcess()` for code that reads directly from
 * the process runtime environment.
 */

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the GCP project ID from a typed env object.
 */
export function resolveGoogleCloudProject(
  env: { GOOGLE_CLOUD_PROJECT?: string },
): string | undefined {
  return trimOrUndefined(env.GOOGLE_CLOUD_PROJECT);
}

/**
 * Resolve the GCP project ID from the process runtime environment.
 */
export function resolveGoogleCloudProjectFromProcess(): string | undefined {
  return trimOrUndefined(getEnv("GOOGLE_CLOUD_PROJECT"));
}
