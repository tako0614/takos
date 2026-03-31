import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deletePortableManagedResource,
  describePortableResourceResolution,
  ensurePortableManagedResource,
  resetPortableResourceRuntimeCachesForTests,
} from '@/services/resources/portable-runtime';

describe('portable managed resource runtime', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-portable-runtime-'));
    process.env.TAKOS_LOCAL_DATA_DIR = tempDir;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    delete process.env.PGVECTOR_ENABLED;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_S3_ENDPOINT;
    delete process.env.AWS_DYNAMO_KV_TABLE;
    delete process.env.AWS_DYNAMO_HOSTNAME_ROUTING_TABLE;
    delete process.env.REDIS_URL;
    delete process.env.GCP_PROJECT_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GCP_FIRESTORE_KV_COLLECTION;
    resetPortableResourceRuntimeCachesForTests();
  });

  afterEach(async () => {
    resetPortableResourceRuntimeCachesForTests();
    delete process.env.TAKOS_LOCAL_DATA_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates and removes sqlite state for portable sql resources', async () => {
    const resource = {
      id: 'res-sql',
      provider_name: 'local',
      provider_resource_name: 'portable-db',
    } as const;
    const sqlitePath = path.join(tempDir, 'managed-resources', 'sql', 'portable-db.sqlite');

    await ensurePortableManagedResource(resource, 'sql');
    await expect(access(sqlitePath)).resolves.toBeUndefined();

    await deletePortableManagedResource(resource, 'sql');
    await expect(access(sqlitePath)).rejects.toBeDefined();
  });

  it('creates and removes file-backed local object, kv, and queue resources', async () => {
    const objectStore = {
      id: 'res-r2',
      provider_name: 'local',
      provider_resource_name: 'portable-bucket',
    } as const;
    const kv = {
      id: 'res-kv',
      provider_name: 'local',
      provider_resource_name: 'portable-kv',
    } as const;
    const queue = {
      id: 'res-queue',
      provider_name: 'local',
      provider_resource_name: 'portable-queue',
    } as const;
    const objectPath = path.join(tempDir, 'managed-resources', 'object-store', 'portable-bucket.json');
    const kvPath = path.join(tempDir, 'managed-resources', 'kv', 'portable-kv.json');
    const queuePath = path.join(tempDir, 'managed-resources', 'queue', 'portable-queue.json');

    await ensurePortableManagedResource(objectStore, 'object_store');
    await ensurePortableManagedResource(kv, 'kv');
    await ensurePortableManagedResource(queue, 'queue');

    await expect(access(objectPath)).resolves.toBeUndefined();
    await expect(access(kvPath)).resolves.toBeUndefined();
    await expect(access(queuePath)).resolves.toBeUndefined();

    await deletePortableManagedResource(objectStore, 'object_store');
    await deletePortableManagedResource(kv, 'kv');
    await deletePortableManagedResource(queue, 'queue');

    await expect(access(objectPath)).rejects.toBeDefined();
    await expect(access(kvPath)).rejects.toBeDefined();
    await expect(access(queuePath)).rejects.toBeDefined();
  });

  it('does not materialize marker files for takos-runtime logical resources', async () => {
    const analytics = {
      id: 'res-analytics',
      provider_name: 'local',
      provider_resource_name: 'portable-events',
    } as const;
    const workflow = {
      id: 'res-workflow',
      provider_name: 'local',
      provider_resource_name: 'portable-flow',
    } as const;
    const durable = {
      id: 'res-durable',
      provider_name: 'local',
      provider_resource_name: 'portable-counter',
    } as const;
    const secret = {
      id: 'res-secret',
      provider_name: 'local',
      provider_resource_name: 'portable-secret',
    } as const;

    const analyticsPath = path.join(tempDir, 'managed-resources', 'analytics-store', 'portable-events.json');
    const workflowPath = path.join(tempDir, 'managed-resources', 'workflow-runtime', 'portable-flow.json');
    const durablePath = path.join(tempDir, 'managed-resources', 'durable-namespace', 'portable-counter.json');
    const secretPath = path.join(tempDir, 'managed-resources', 'secret', 'portable-secret.json');

    await ensurePortableManagedResource(analytics, 'analytics_store');
    await ensurePortableManagedResource(workflow, 'workflow_runtime');
    await ensurePortableManagedResource(durable, 'durable_namespace');
    await ensurePortableManagedResource(secret, 'secret');

    await expect(access(analyticsPath)).rejects.toBeDefined();
    await expect(access(workflowPath)).rejects.toBeDefined();
    await expect(access(durablePath)).rejects.toBeDefined();
    await expect(access(secretPath)).resolves.toBeUndefined();

    const secretState = JSON.parse(await readFile(secretPath, 'utf-8')) as { value?: string };
    expect(typeof secretState.value).toBe('string');
    expect(secretState.value?.length).toBeGreaterThan(0);

    await deletePortableManagedResource(analytics, 'analytics_store');
    await deletePortableManagedResource(workflow, 'workflow_runtime');
    await deletePortableManagedResource(durable, 'durable_namespace');
    await deletePortableManagedResource(secret, 'secret');

    await expect(access(analyticsPath)).rejects.toBeDefined();
    await expect(access(workflowPath)).rejects.toBeDefined();
    await expect(access(durablePath)).rejects.toBeDefined();
    await expect(access(secretPath)).rejects.toBeDefined();
  });

  it('requires pgvector bootstrap for portable vector indexes', async () => {
    const vector = {
      id: 'res-vector',
      provider_name: 'aws',
      provider_resource_name: 'portable-vector',
    } as const;

    await expect(ensurePortableManagedResource(vector, 'vector_index')).rejects.toThrow(
      'POSTGRES_URL or DATABASE_URL, PGVECTOR_ENABLED=true',
    );
  });

  it('describes provider-backed vs takos-runtime resolutions', () => {
    expect(describePortableResourceResolution('aws', 'sql')).toMatchObject({
      mode: 'provider-backed',
      backend: 'postgres-schema-d1-adapter',
      requirements: ['POSTGRES_URL or DATABASE_URL'],
    });
    expect(describePortableResourceResolution('aws', 'queue')).toMatchObject({
      mode: 'provider-backed',
      backend: 'sqs-queue',
      requirements: [],
    });
    expect(describePortableResourceResolution('aws', 'secretRef')).toMatchObject({
      mode: 'provider-backed',
      backend: 'aws-secrets-manager',
      requirements: [],
    });
    expect(describePortableResourceResolution('k8s', 'queue')).toMatchObject({
      mode: 'provider-backed',
      backend: 'redis-queue',
      requirements: ['REDIS_URL'],
    });
    expect(describePortableResourceResolution('k8s', 'secretRef')).toMatchObject({
      mode: 'provider-backed',
      backend: 'k8s-secret',
      requirements: expect.arrayContaining(['K8S_API_SERVER or in-cluster Kubernetes service env']),
    });
    expect(describePortableResourceResolution('local', 'workflow')).toMatchObject({
      mode: 'takos-runtime',
      backend: 'workflow-binding',
      requirements: [],
    });
  });
});
