/**
 * Object storage resolver — selects S3/GCS/persistent/in-memory per bucket.
 */
import path from 'node:path';
import { optionalEnv } from './env-helpers.ts';
import {
  createInMemoryR2Bucket,
} from '../../local-platform/in-memory-bindings.ts';
import {
  createPersistentR2Bucket,
} from '../../local-platform/persistent-bindings.ts';

// ---------------------------------------------------------------------------
// Bucket configuration
// ---------------------------------------------------------------------------

export const BUCKET_NAMES = [
  'GIT_OBJECTS',
  'TAKOS_OFFLOAD',
  'TENANT_SOURCE',
  'WORKER_BUNDLES',
  'TENANT_BUILDS',
  'UI_BUNDLES',
] as const;

export type BucketName = (typeof BUCKET_NAMES)[number];

const S3_ENV_MAP: Record<BucketName, string> = {
  GIT_OBJECTS: 'AWS_S3_GIT_OBJECTS_BUCKET',
  TAKOS_OFFLOAD: 'AWS_S3_OFFLOAD_BUCKET',
  TENANT_SOURCE: 'AWS_S3_TENANT_SOURCE_BUCKET',
  WORKER_BUNDLES: 'AWS_S3_WORKER_BUNDLES_BUCKET',
  TENANT_BUILDS: 'AWS_S3_TENANT_BUILDS_BUCKET',
  UI_BUNDLES: 'AWS_S3_UI_BUNDLES_BUCKET',
};

const GCS_ENV_MAP: Record<BucketName, string> = {
  GIT_OBJECTS: 'GCP_GCS_GIT_OBJECTS_BUCKET',
  TAKOS_OFFLOAD: 'GCP_GCS_OFFLOAD_BUCKET',
  TENANT_SOURCE: 'GCP_GCS_TENANT_SOURCE_BUCKET',
  WORKER_BUNDLES: 'GCP_GCS_WORKER_BUNDLES_BUCKET',
  TENANT_BUILDS: 'GCP_GCS_TENANT_BUILDS_BUCKET',
  UI_BUNDLES: 'GCP_GCS_UI_BUNDLES_BUCKET',
};

const PERSISTENT_BUCKET_MAP: Record<BucketName, string> = {
  GIT_OBJECTS: 'git-objects.json',
  TAKOS_OFFLOAD: 'takos-offload.json',
  TENANT_SOURCE: 'tenant-source.json',
  WORKER_BUNDLES: 'worker-bundles.json',
  TENANT_BUILDS: 'tenant-builds.json',
  UI_BUNDLES: 'ui-bundles.json',
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveBucket(name: BucketName, dataDir: string | null) {
  // S3 (including MinIO / S3-compatible)
  const s3Bucket = optionalEnv(S3_ENV_MAP[name]);
  if (s3Bucket) {
    const { createS3ObjectStore } = await import('../../adapters/s3-object-store.ts');
    return createS3ObjectStore({
      region: optionalEnv('AWS_REGION') ?? 'us-east-1',
      bucket: s3Bucket,
      accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
      endpoint: optionalEnv('AWS_S3_ENDPOINT'),
    });
  }

  // GCS
  const gcsBucket = optionalEnv(GCS_ENV_MAP[name]);
  if (gcsBucket) {
    const { createGcsObjectStore } = await import('../../adapters/gcs-object-store.ts');
    return createGcsObjectStore({
      bucket: gcsBucket,
      projectId: optionalEnv('GCP_PROJECT_ID'),
      keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
    });
  }

  // Persistent local
  if (dataDir) return createPersistentR2Bucket(path.join(dataDir, 'buckets', PERSISTENT_BUCKET_MAP[name]));

  // In-memory
  return createInMemoryR2Bucket();
}
