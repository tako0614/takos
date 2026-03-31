import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deletePortableManagedResource,
  describePortableResourceResolution,
  ensurePortableManagedResource,
  resetPortableResourceRuntimeCachesForTests,
} from '@/services/resources/portable-runtime';


import { assertEquals, assert, assertRejects, assertObjectMatch } from 'jsr:@std/assert';

  let tempDir: string;
  Deno.test('portable managed resource runtime - creates and removes sqlite state for portable sql resources', async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-portable-runtime-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDir);
    Deno.env.delete('POSTGRES_URL');
    Deno.env.delete('DATABASE_URL');
    Deno.env.delete('PGVECTOR_ENABLED');
    Deno.env.delete('AWS_ACCESS_KEY_ID');
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    Deno.env.delete('AWS_S3_ENDPOINT');
    Deno.env.delete('AWS_DYNAMO_KV_TABLE');
    Deno.env.delete('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE');
    Deno.env.delete('REDIS_URL');
    Deno.env.delete('GCP_PROJECT_ID');
    Deno.env.delete('GOOGLE_APPLICATION_CREDENTIALS');
    Deno.env.delete('GCP_FIRESTORE_KV_COLLECTION');
    resetPortableResourceRuntimeCachesForTests();
  try {
  const resource = {
      id: 'res-sql',
      provider_name: 'local',
      provider_resource_name: 'portable-db',
    } as const;
    const sqlitePath = path.join(tempDir, 'managed-resources', 'sql', 'portable-db.sqlite');

    await ensurePortableManagedResource(resource, 'sql');
    await assertEquals(await access(sqlitePath), undefined);

    await deletePortableManagedResource(resource, 'sql');
    await await assertRejects(async () => { await access(sqlitePath); });
  } finally {
  resetPortableResourceRuntimeCachesForTests();
    Deno.env.delete('TAKOS_LOCAL_DATA_DIR');
    await rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('portable managed resource runtime - creates and removes file-backed local object, kv, and queue resources', async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-portable-runtime-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDir);
    Deno.env.delete('POSTGRES_URL');
    Deno.env.delete('DATABASE_URL');
    Deno.env.delete('PGVECTOR_ENABLED');
    Deno.env.delete('AWS_ACCESS_KEY_ID');
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    Deno.env.delete('AWS_S3_ENDPOINT');
    Deno.env.delete('AWS_DYNAMO_KV_TABLE');
    Deno.env.delete('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE');
    Deno.env.delete('REDIS_URL');
    Deno.env.delete('GCP_PROJECT_ID');
    Deno.env.delete('GOOGLE_APPLICATION_CREDENTIALS');
    Deno.env.delete('GCP_FIRESTORE_KV_COLLECTION');
    resetPortableResourceRuntimeCachesForTests();
  try {
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

    await assertEquals(await access(objectPath), undefined);
    await assertEquals(await access(kvPath), undefined);
    await assertEquals(await access(queuePath), undefined);

    await deletePortableManagedResource(objectStore, 'object_store');
    await deletePortableManagedResource(kv, 'kv');
    await deletePortableManagedResource(queue, 'queue');

    await await assertRejects(async () => { await access(objectPath); });
    await await assertRejects(async () => { await access(kvPath); });
    await await assertRejects(async () => { await access(queuePath); });
  } finally {
  resetPortableResourceRuntimeCachesForTests();
    Deno.env.delete('TAKOS_LOCAL_DATA_DIR');
    await rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('portable managed resource runtime - does not materialize marker files for takos-runtime logical resources', async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-portable-runtime-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDir);
    Deno.env.delete('POSTGRES_URL');
    Deno.env.delete('DATABASE_URL');
    Deno.env.delete('PGVECTOR_ENABLED');
    Deno.env.delete('AWS_ACCESS_KEY_ID');
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    Deno.env.delete('AWS_S3_ENDPOINT');
    Deno.env.delete('AWS_DYNAMO_KV_TABLE');
    Deno.env.delete('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE');
    Deno.env.delete('REDIS_URL');
    Deno.env.delete('GCP_PROJECT_ID');
    Deno.env.delete('GOOGLE_APPLICATION_CREDENTIALS');
    Deno.env.delete('GCP_FIRESTORE_KV_COLLECTION');
    resetPortableResourceRuntimeCachesForTests();
  try {
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

    await await assertRejects(async () => { await access(analyticsPath); });
    await await assertRejects(async () => { await access(workflowPath); });
    await await assertRejects(async () => { await access(durablePath); });
    await assertEquals(await access(secretPath), undefined);

    const secretState = JSON.parse(await readFile(secretPath, 'utf-8')) as { value?: string };
    assertEquals(typeof secretState.value, 'string');
    assert(secretState.value?.length > 0);

    await deletePortableManagedResource(analytics, 'analytics_store');
    await deletePortableManagedResource(workflow, 'workflow_runtime');
    await deletePortableManagedResource(durable, 'durable_namespace');
    await deletePortableManagedResource(secret, 'secret');

    await await assertRejects(async () => { await access(analyticsPath); });
    await await assertRejects(async () => { await access(workflowPath); });
    await await assertRejects(async () => { await access(durablePath); });
    await await assertRejects(async () => { await access(secretPath); });
  } finally {
  resetPortableResourceRuntimeCachesForTests();
    Deno.env.delete('TAKOS_LOCAL_DATA_DIR');
    await rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('portable managed resource runtime - requires pgvector bootstrap for portable vector indexes', async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-portable-runtime-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDir);
    Deno.env.delete('POSTGRES_URL');
    Deno.env.delete('DATABASE_URL');
    Deno.env.delete('PGVECTOR_ENABLED');
    Deno.env.delete('AWS_ACCESS_KEY_ID');
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    Deno.env.delete('AWS_S3_ENDPOINT');
    Deno.env.delete('AWS_DYNAMO_KV_TABLE');
    Deno.env.delete('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE');
    Deno.env.delete('REDIS_URL');
    Deno.env.delete('GCP_PROJECT_ID');
    Deno.env.delete('GOOGLE_APPLICATION_CREDENTIALS');
    Deno.env.delete('GCP_FIRESTORE_KV_COLLECTION');
    resetPortableResourceRuntimeCachesForTests();
  try {
  const vector = {
      id: 'res-vector',
      provider_name: 'aws',
      provider_resource_name: 'portable-vector',
    } as const;

    await await assertRejects(async () => { await ensurePortableManagedResource(vector, 'vector_index'); }, 
      'POSTGRES_URL or DATABASE_URL, PGVECTOR_ENABLED=true',
    );
  } finally {
  resetPortableResourceRuntimeCachesForTests();
    Deno.env.delete('TAKOS_LOCAL_DATA_DIR');
    await rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('portable managed resource runtime - describes provider-backed vs takos-runtime resolutions', () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-portable-runtime-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDir);
    Deno.env.delete('POSTGRES_URL');
    Deno.env.delete('DATABASE_URL');
    Deno.env.delete('PGVECTOR_ENABLED');
    Deno.env.delete('AWS_ACCESS_KEY_ID');
    Deno.env.delete('AWS_SECRET_ACCESS_KEY');
    Deno.env.delete('AWS_S3_ENDPOINT');
    Deno.env.delete('AWS_DYNAMO_KV_TABLE');
    Deno.env.delete('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE');
    Deno.env.delete('REDIS_URL');
    Deno.env.delete('GCP_PROJECT_ID');
    Deno.env.delete('GOOGLE_APPLICATION_CREDENTIALS');
    Deno.env.delete('GCP_FIRESTORE_KV_COLLECTION');
    resetPortableResourceRuntimeCachesForTests();
  try {
  assertObjectMatch(describePortableResourceResolution('aws', 'sql'), {
      mode: 'provider-backed',
      backend: 'postgres-schema-d1-adapter',
      requirements: ['POSTGRES_URL or DATABASE_URL'],
    });
    assertObjectMatch(describePortableResourceResolution('aws', 'queue'), {
      mode: 'provider-backed',
      backend: 'sqs-queue',
      requirements: [],
    });
    assertObjectMatch(describePortableResourceResolution('aws', 'secretRef'), {
      mode: 'provider-backed',
      backend: 'aws-secrets-manager',
      requirements: [],
    });
    assertObjectMatch(describePortableResourceResolution('k8s', 'queue'), {
      mode: 'provider-backed',
      backend: 'redis-queue',
      requirements: ['REDIS_URL'],
    });
    assertObjectMatch(describePortableResourceResolution('k8s', 'secretRef'), {
      mode: 'provider-backed',
      backend: 'k8s-secret',
      requirements: (['K8S_API_SERVER or in-cluster Kubernetes service env']),
    });
    assertObjectMatch(describePortableResourceResolution('local', 'workflow'), {
      mode: 'takos-runtime',
      backend: 'workflow-binding',
      requirements: [],
    });
  } finally {
  resetPortableResourceRuntimeCachesForTests();
    Deno.env.delete('TAKOS_LOCAL_DATA_DIR');
    await rm(tempDir, { recursive: true, force: true });
  }
})