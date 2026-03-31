/**
 * Shared environment helpers for the Node.js platform resolvers.
 */
import path from 'node:path';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

export function optionalEnv(name: string): string | undefined {
  return Deno.env.get(name)?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

export function resolveLocalDataDir(): string | null {
  const explicit = optionalEnv('TAKOS_LOCAL_DATA_DIR');
  if (explicit) return path.resolve(explicit);
  if (Deno.env.get('VITEST')) return null;
  // Only use the default directory if no cloud storage env vars are set —
  // this avoids accidentally creating a .takos-local directory when running
  // on a cloud platform.
  if (hasCloudBindings()) return null;
  return path.resolve(process.cwd(), '.takos-local');
}

export function resolvePostgresUrl(): string | null {
  const raw = optionalEnv('POSTGRES_URL') ?? optionalEnv('DATABASE_URL') ?? '';
  if (!raw) return null;
  if (!/^postgres(ql)?:\/\//i.test(raw)) return null;
  return raw;
}

export function resolveRedisUrl(): string | null {
  return optionalEnv('REDIS_URL') ?? null;
}

function hasCloudBindings(): boolean {
  return !!(
    optionalEnv('AWS_S3_GIT_OBJECTS_BUCKET') ||
    optionalEnv('GCP_GCS_GIT_OBJECTS_BUCKET') ||
    optionalEnv('AWS_ECS_CLUSTER_ARN') ||
    optionalEnv('GCP_PROJECT_ID')
  );
}
