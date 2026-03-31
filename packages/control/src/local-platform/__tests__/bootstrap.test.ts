import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import {
  createLocalBrowserHostFetchForTests,
  createLocalDispatchFetchForTests,
  createLocalExecutorHostFetchForTests,
  createLocalRuntimeHostFetchForTests,
  createLocalWebFetchForTests,
} from '../bootstrap.ts';
import {
  LOCAL_DEV_DEFAULTS,
  clearNodePlatformDataForTests,
  createNodeWebEnv,
  resetNodePlatformStateForTests,
} from '../../node-platform/env-builder.ts';
import { createLocalTenantWorkerRuntimeRegistry } from '../tenant-worker-runtime.ts';
import type { WorkerBinding } from '../../application/services/wfp/index.ts';
import { RUN_QUEUE_MESSAGE_VERSION } from '../../shared/types/index.ts';
import { accounts, deployments, getDb } from '../../infra/db/index.ts';
import { services } from '../../infra/db/schema-services.ts';
import { encrypt } from '../../shared/utils/crypto.ts';
import { MockMiniflare } from './mock-miniflare.ts';

import { assertEquals, assertRejects, assertStringIncludes, assertObjectMatch } from 'jsr:@std/assert';
import { stub, assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const queueMocks = ({
  sqsSend: (async () => undefined),
  sqsSendBatch: (async () => undefined),
});

// [Deno] vi.mock removed - manually stub imports from 'miniflare'// [Deno] vi.mock removed - manually stub imports from '../../adapters/sqs-queue.ts'
async function runMiniflareDispatchSmoke(): Promise<{ status: number; body: unknown }> {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
  Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
  Deno.env.set('TAKOS_LOCAL_ROUTING_JSON', JSON.stringify({
    'hello.local': {
      type: 'deployments',
      deployments: [{ routeRef: 'worker-demo-v1', weight: 100, status: 'active' }],
    },
  }));

  const tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-dispatch-smoke-'));
  Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
  await clearNodePlatformDataForTests();
  await resetNodePlatformStateForTests();

  const env = await createNodeWebEnv();

  try {
    await seedTenantWorkerBundle({
      env,
      bundleContent: `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({
              ok: true,
              worker: 'worker-demo-v1',
              path: new URL(request.url).pathname
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        };
      `,
    });

    const fetch = await createLocalDispatchFetchForTests();
    const response = await fetch(new Request('http://hello.local/api/demo'));

    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await resetNodePlatformStateForTests();
    await rm(tempDataDir, { recursive: true, force: true });
  }
}

async function seedTenantWorkerBundle(params: {
  env: Awaited<ReturnType<typeof createNodeWebEnv>>;
  serviceId?: string;
  routeRef?: string;
  deploymentId?: string;
  artifactRef?: string;
  bundleR2Key?: string;
  bundleContent: string;
  targetJson?: string;
  routingStatus?: 'active' | 'canary' | 'rollback';
  routingWeight?: number;
  version?: number;
  bindingsSnapshot?: WorkerBinding[];
}): Promise<void> {
  const {
    env,
    serviceId = 'worker-demo',
    routeRef = 'worker-demo',
    deploymentId = 'deployment-demo-v1',
    artifactRef = 'worker-demo-v1',
    bundleR2Key = 'deployments/worker-demo/1/bundle.js',
    bundleContent,
    targetJson = JSON.stringify({ route_ref: routeRef, endpoint: { kind: 'service-ref', ref: routeRef } }),
    routingStatus = 'active',
    routingWeight = 100,
    version = 1,
    bindingsSnapshot,
  } = params;
  const db = getDb(env.DB);
  const resolvedDeploymentId = deploymentId;
  const encryptionKey = env.ENCRYPTION_KEY ?? LOCAL_DEV_DEFAULTS.ENCRYPTION_KEY;
  const bindingsSnapshotEncrypted = bindingsSnapshot?.length
    ? JSON.stringify(await encrypt(JSON.stringify(bindingsSnapshot), encryptionKey, resolvedDeploymentId))
    : null;
  await db.insert(accounts).values({
    id: 'space-demo',
    type: 'workspace',
    status: 'active',
    name: 'Space Demo',
    slug: 'space-demo',
  }).run();
  await db.insert(services).values({
    id: serviceId,
    accountId: 'space-demo',
    serviceType: 'app',
    status: 'active',
    routeRef,
    activeDeploymentId: resolvedDeploymentId,
  }).run();
  await db.insert(deployments).values({
    id: resolvedDeploymentId,
    serviceId,
    accountId: 'space-demo',
    version,
    artifactRef,
    bundleR2Key,
    runtimeConfigSnapshotJson: '{}',
    bindingsSnapshotEncrypted,
    targetJson,
    status: 'active',
    routingStatus,
    routingWeight,
  }).run();
  await env.WORKER_BUNDLES?.put(bundleR2Key, bundleContent);
}


  const originalEnv = {
    ADMIN_DOMAIN: Deno.env.get('ADMIN_DOMAIN'),
    TENANT_BASE_DOMAIN: Deno.env.get('TENANT_BASE_DOMAIN'),
    TAKOS_LOCAL_ROUTING_JSON: Deno.env.get('TAKOS_LOCAL_ROUTING_JSON'),
    TAKOS_LOCAL_DISPATCH_TARGETS_JSON: Deno.env.get('TAKOS_LOCAL_DISPATCH_TARGETS_JSON'),
    TAKOS_LOCAL_DATA_DIR: Deno.env.get('TAKOS_LOCAL_DATA_DIR'),
    TAKOS_LOCAL_RUNTIME_URL: Deno.env.get('TAKOS_LOCAL_RUNTIME_URL'),
    TAKOS_LOCAL_EXECUTOR_URL: Deno.env.get('TAKOS_LOCAL_EXECUTOR_URL'),
    TAKOS_LOCAL_BROWSER_URL: Deno.env.get('TAKOS_LOCAL_BROWSER_URL'),
  };
  let tempDataDir: string | null = null;
  Deno.test('local bootstrap - serves takos-web health without Cloudflare bindings', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalWebFetchForTests();

    const response = await fetch(new Request('http://admin.local/health'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { status: 'ok' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - does not synthesize fake Cloudflare credentials in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();

    assertEquals(env.CF_ACCOUNT_ID, undefined);
    assertEquals(env.CF_API_TOKEN, undefined);
    assertEquals(env.WFP_DISPATCH_NAMESPACE, undefined);
    assertEquals(env.CF_ZONE_ID, undefined);
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - allows loopback health checks in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalWebFetchForTests();

    const response = await fetch(new Request('http://127.0.0.1/health'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { status: 'ok' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - allows compose-internal health checks in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalWebFetchForTests();

    const response = await fetch(new Request('http://control-web/health'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { status: 'ok' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - returns 503 when dispatch routing resolves to an unconfigured worker target', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_ROUTING_JSON', JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [{ routeRef: 'tenant-app', weight: 100, status: 'active' }],
      },
    }));
    const fetch = await createLocalDispatchFetchForTests();

    const response = await fetch(new Request('http://hello.local/runs'));

    assertEquals(response.status, 503);
    await assertEquals(await response.json(), ({
      error: 'Tenant worker not found',
      message: 'The tenant worker may be provisioning or has been deleted',
    }));
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - serves dispatch health in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalDispatchFetchForTests();

    const response = await fetch(new Request('http://dispatch.local/health'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { status: 'ok', service: 'takos-dispatch' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - rejects tenant worker URL overrides in local dispatch config', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_DISPATCH_TARGETS_JSON', JSON.stringify({
      'tenant-app': 'http://worker.internal/base/',
    }));

    await await assertRejects(async () => { await createLocalDispatchFetchForTests(); }, 
      /TAKOS_LOCAL_DISPATCH_TARGETS_JSON may only override infra service targets/,
    );
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - forwards dispatch traffic to http-endpoint-set URL targets', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_ROUTING_JSON', JSON.stringify({
      'hello.local': {
        type: 'http-endpoint-set',
        endpoints: [
          {
            name: 'oci-public',
            routes: [{ pathPrefix: '/api' }],
            target: {
              kind: 'http-url',
              baseUrl: 'http://worker.internal/base/',
            },
          },
        ],
      },
    }));

    const upstreamFetch = async (request: Request) => {
      assertEquals(request.url, 'http://worker.internal/base/api/runs?view=full');
      assertEquals(request.headers.get('X-Forwarded-Host'), 'hello.local');
      assertEquals(request.headers.get('X-Tenant-Endpoint'), 'oci-public');
      assertEquals(request.headers.get('X-Tenant-Worker'), null);
      return new Response('ok-url', { status: 200 });
    };

    (globalThis as any).fetch = upstreamFetch;

    const fetch = await createLocalDispatchFetchForTests();
    const response = await fetch(new Request('http://hello.local/api/runs?view=full'));

    assertSpyCalls(upstreamFetch, 1);
    assertEquals(response.status, 200);
    await assertEquals(await response.text(), 'ok-url');
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - dispatches to a locally materialized tenant worker via Miniflare when no URL target is configured', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const response = await runMiniflareDispatchSmoke();

    assertEquals(response.status, 200);
    assertEquals(response.body, {
      ok: true,
      worker: 'worker-demo-v1',
      path: '/api/demo',
    });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - materializes tenant workers by default when no URL target is configured', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_ROUTING_JSON', JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [{ routeRef: 'worker-demo-v1', weight: 100, status: 'active' }],
      },
    }));

    const env = await createNodeWebEnv();
    const db = getDb(env.DB);
    await db.insert(accounts).values({
      id: 'space-demo',
      type: 'workspace',
      status: 'active',
      name: 'Space Demo',
      slug: 'space-demo',
    }).run();
    await db.insert(services).values({
      id: 'worker-demo',
      accountId: 'space-demo',
      serviceType: 'app',
      status: 'active',
      routeRef: 'worker-demo',
    }).run();
    await db.insert(deployments).values({
      id: 'deployment-demo-v1',
      serviceId: 'worker-demo',
      accountId: 'space-demo',
      version: 1,
      artifactRef: 'worker-demo-v1',
      bundleR2Key: 'deployments/worker-demo/1/bundle.js',
      runtimeConfigSnapshotJson: '{}',
      status: 'active',
      routingStatus: 'active',
      routingWeight: 100,
    }).run();
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/1/bundle.js', `
      export default {
        async fetch(request) {
          return new Response(JSON.stringify({
            ok: true,
            worker: 'worker-demo-v1',
            path: new URL(request.url).pathname
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      };
    `);

    const fetch = await createLocalDispatchFetchForTests();
    const response = await fetch(new Request('http://hello.local/api/demo'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), {
      ok: true,
      worker: 'worker-demo-v1',
      path: '/api/demo',
    });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - dispatches scheduled events through the canonical local tenant runtime registry', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bundleContent: `
        let lastScheduled = null;
        export default {
          async fetch() {
            return new Response(JSON.stringify({ lastScheduled }), {
              headers: { 'Content-Type': 'application/json' }
            });
          },
          async scheduled(controller) {
            lastScheduled = {
              cron: controller.cron,
              scheduledTime: controller.scheduledTime,
            };
          }
        };
      `,
    });

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      const scheduledResult = await registry.dispatchScheduled('worker-demo', {
        cron: '0 * * * *',
        scheduledTime: new Date('2026-03-25T00:00:00.000Z'),
      });

      assertObjectMatch(scheduledResult, {
        outcome: /* expect.any(String) */ {} as any,
        noRetry: /* expect.any(Boolean) */ {} as any,
      });

      const response = await registry.get('worker-demo').fetch('http://worker-demo/internal/state');
      await assertEquals(await response.json(), {
        lastScheduled: {
          cron: '0 * * * *',
          scheduledTime: Date.parse('2026-03-25T00:00:00.000Z'),
        },
      });
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - dispatches queue events through the canonical local tenant runtime registry', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bundleContent: `
        let lastQueue = null;
        export default {
          async fetch() {
            return new Response(JSON.stringify({ lastQueue }), {
              headers: { 'Content-Type': 'application/json' }
            });
          },
          async queue(batch) {
            lastQueue = {
              queue: batch.queue,
              ids: batch.messages.map((message) => message.id),
              values: batch.messages.map((message) => message.body.value),
            };
            for (const message of batch.messages) message.ack();
          }
        };
      `,
    });

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      const queueResult = await registry.dispatchQueue('worker-demo', 'tenant-jobs', [
        {
          id: 'msg-1',
          timestamp: new Date('2026-03-25T01:00:00.000Z'),
          attempts: 1,
          body: { value: 'alpha' },
        },
        {
          id: 'msg-2',
          timestamp: new Date('2026-03-25T01:00:01.000Z'),
          attempts: 1,
          body: { value: 'beta' },
        },
      ]);

      assertObjectMatch(queueResult, {
        outcome: /* expect.any(String) */ {} as any,
        ackAll: /* expect.any(Boolean) */ {} as any,
      });

      const response = await registry.get('worker-demo').fetch('http://worker-demo/internal/state');
      await assertEquals(await response.json(), {
        lastQueue: {
          queue: 'tenant-jobs',
          ids: ['msg-1', 'msg-2'],
          values: ['alpha', 'beta'],
        },
      });
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - dispatches scheduled events against the selected deployment when stable route refs share a service name', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      deploymentId: 'deployment-demo-v1',
      artifactRef: 'worker-demo-v1',
      bundleR2Key: 'deployments/worker-demo/1/bundle.js',
      version: 1,
      bundleContent: `
        let lastScheduled = null;
        export default {
          async fetch() {
            return new Response(JSON.stringify({ worker: 'worker-demo-v1', lastScheduled }), {
              headers: { 'Content-Type': 'application/json' }
            });
          },
          async scheduled(controller) {
            lastScheduled = { worker: 'worker-demo-v1', cron: controller.cron };
          }
        };
      `,
    });
    const db = getDb(env.DB);
    await db.insert(deployments).values({
      id: 'deployment-demo-v2',
      serviceId: 'worker-demo',
      accountId: 'space-demo',
      version: 2,
      artifactRef: 'worker-demo-v2',
      bundleR2Key: 'deployments/worker-demo/2/bundle.js',
      runtimeConfigSnapshotJson: '{}',
      targetJson: JSON.stringify({ route_ref: 'worker-demo', endpoint: { kind: 'service-ref', ref: 'worker-demo' } }),
      status: 'active',
      routingStatus: 'canary',
      routingWeight: 100,
    }).run();
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/2/bundle.js', `
      let lastScheduled = null;
      export default {
        async fetch() {
          return new Response(JSON.stringify({ worker: 'worker-demo-v2', lastScheduled }), {
            headers: { 'Content-Type': 'application/json' }
          });
        },
        async scheduled(controller) {
          lastScheduled = { worker: 'worker-demo-v2', cron: controller.cron };
        }
      };
    `);

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      await registry.dispatchScheduled('worker-demo', { cron: '*/5 * * * *' }, { deploymentId: 'deployment-demo-v2' });

      const canaryResponse = await registry.get('worker-demo', { deploymentId: 'deployment-demo-v2' }).fetch('http://worker-demo/internal/state');
      await assertEquals(await canaryResponse.json(), {
        worker: 'worker-demo-v2',
        lastScheduled: { worker: 'worker-demo-v2', cron: '*/5 * * * *' },
      });

      const activeResponse = await registry.get('worker-demo', { deploymentId: 'deployment-demo-v1' }).fetch('http://worker-demo/internal/state');
      await assertEquals(await activeResponse.json(), {
        worker: 'worker-demo-v1',
        lastScheduled: null,
      });
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - dispatches queue events against the selected deployment when stable route refs share a service name', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      deploymentId: 'deployment-demo-v1',
      artifactRef: 'worker-demo-v1',
      bundleR2Key: 'deployments/worker-demo/1/bundle.js',
      version: 1,
      bundleContent: `
        let lastQueue = null;
        export default {
          async fetch() {
            return new Response(JSON.stringify({ worker: 'worker-demo-v1', lastQueue }), {
              headers: { 'Content-Type': 'application/json' }
            });
          },
          async queue(batch) {
            lastQueue = { worker: 'worker-demo-v1', queue: batch.queue, ids: batch.messages.map((message) => message.id) };
            for (const message of batch.messages) message.ack();
          }
        };
      `,
    });
    const db = getDb(env.DB);
    await db.insert(deployments).values({
      id: 'deployment-demo-v2',
      serviceId: 'worker-demo',
      accountId: 'space-demo',
      version: 2,
      artifactRef: 'worker-demo-v2',
      bundleR2Key: 'deployments/worker-demo/2/bundle.js',
      runtimeConfigSnapshotJson: '{}',
      targetJson: JSON.stringify({ route_ref: 'worker-demo', endpoint: { kind: 'service-ref', ref: 'worker-demo' } }),
      status: 'active',
      routingStatus: 'canary',
      routingWeight: 100,
    }).run();
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/2/bundle.js', `
      let lastQueue = null;
      export default {
        async fetch() {
          return new Response(JSON.stringify({ worker: 'worker-demo-v2', lastQueue }), {
            headers: { 'Content-Type': 'application/json' }
          });
        },
        async queue(batch) {
          lastQueue = { worker: 'worker-demo-v2', queue: batch.queue, ids: batch.messages.map((message) => message.id) };
          for (const message of batch.messages) message.ack();
        }
      };
    `);

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      await registry.dispatchQueue('worker-demo', 'tenant-jobs', [{
        id: 'msg-canary',
        timestamp: new Date('2026-03-25T02:00:00.000Z'),
        attempts: 1,
        body: { value: 'gamma' },
      }], { deploymentId: 'deployment-demo-v2' });

      const canaryResponse = await registry.get('worker-demo', { deploymentId: 'deployment-demo-v2' }).fetch('http://worker-demo/internal/state');
      await assertEquals(await canaryResponse.json(), {
        worker: 'worker-demo-v2',
        lastQueue: { worker: 'worker-demo-v2', queue: 'tenant-jobs', ids: ['msg-canary'] },
      });

      const activeResponse = await registry.get('worker-demo', { deploymentId: 'deployment-demo-v1' }).fetch('http://worker-demo/internal/state');
      await assertEquals(await activeResponse.json(), {
        worker: 'worker-demo-v1',
        lastQueue: null,
      });
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - creates a workflow instance when local tenant workflow invocation is requested', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bindingsSnapshot: [{ type: 'workflow', name: 'RUN_WORKFLOW', workflow_name: 'runWorkflow', class_name: 'RunWorkflow' }],
      bundleContent: `
        export default {
          async fetch() {
            return new Response('ok');
          }
        };
      `,
    });

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      const result = await registry.invokeWorkflow('worker-demo', { exportName: 'runWorkflow', payload: { job: 'demo' } });
      assertEquals(result.workflowName, 'runWorkflow');
      assertEquals(result.status, 'queued');
      assertEquals(result.id, /* expect.any(String) */ {} as any);
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - rejects deployment ids that do not belong to the requested tenant worker', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      serviceId: 'worker-alpha',
      routeRef: 'worker-alpha',
      deploymentId: 'deployment-alpha-v1',
      artifactRef: 'worker-alpha-v1',
      bundleR2Key: 'deployments/worker-alpha/1/bundle.js',
      bundleContent: `
        export default {
          async fetch() {
            return new Response('alpha');
          }
        };
      `,
    });

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      await await assertRejects(async () => { await 
        registry.get('worker-beta', { deploymentId: 'deployment-alpha-v1' }).fetch('http://worker-beta/internal/state'),
      ; }, /does not belong to local tenant worker worker-beta/i);
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - materializes local tenant queue producer bindings', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bindingsSnapshot: [{ type: 'queue', name: 'JOBS', queue_name: 'tenant-jobs' }],
      bundleContent: `
        export default {
          async fetch(_request, env) {
            await env.JOBS.send({ value: 'alpha' });
            return Response.json({
              ok: true,
              hasSend: typeof env.JOBS?.send === 'function',
            });
          }
        };
      `,
    });

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      const response = await registry.get('worker-demo').fetch('http://worker-demo/internal/state');
      await assertEquals(await response.json(), {
        ok: true,
        hasSend: true,
      });
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - materializes provider-backed tenant queue producer bindings', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bindingsSnapshot: [{
        type: 'queue',
        name: 'JOBS',
        queue_name: 'tenant-jobs',
        queue_backend: 'sqs',
        queue_url: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/tenant-jobs',
      }],
      bundleContent: `
        export default {
          async fetch(_request, env) {
            await env.JOBS.send({ value: 'beta' });
            return Response.json({
              ok: true,
              hasSend: typeof env.JOBS?.send === 'function',
            });
          }
        };
      `,
    });

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      const response = await registry.get('worker-demo').fetch('http://worker-demo/internal/state');
      await assertEquals(await response.json(), {
        ok: true,
        hasSend: true,
      });
      assertSpyCallArgs(queueMocks.sqsSend, 0, [{ value: 'beta' }, undefined]);
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - materializes local tenant durable object bindings', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bindingsSnapshot: [{ type: 'durable_object_namespace', name: 'COUNTER', class_name: 'Counter' }],
      bundleContent: `
        export class Counter {
          async fetch(request) {
            return Response.json({
              ok: true,
              path: new URL(request.url).pathname,
            });
          }
        }

        export default {
          async fetch(_request, env) {
            const stub = env.COUNTER.get(env.COUNTER.idFromName('alpha'));
            return stub.fetch('http://do/internal/state');
          }
        };
      `,
    });

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      const response = await registry.get('worker-demo').fetch('http://worker-demo/internal/state');
      await assertEquals(await response.json(), {
        ok: true,
        path: '/internal/state',
      });
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - materializes local tenant analytics engine bindings', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bindingsSnapshot: [{ type: 'analytics_engine', name: 'EVENTS', dataset: 'tenant_events' }],
      bundleContent: `
        export default {
          async fetch(_request, env) {
            env.EVENTS.writeDataPoint({
              blobs: ['signup'],
              doubles: [1],
              indexes: ['tenant_events'],
            });
            return Response.json({
              ok: true,
              hasWriteDataPoint: typeof env.EVENTS?.writeDataPoint === 'function',
            });
          }
        };
      `,
    });

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      const response = await registry.get('worker-demo').fetch('http://worker-demo/internal/state');
      await assertEquals(await response.json(), {
        ok: true,
        hasWriteDataPoint: true,
      });
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - materializes local tenant workflow bindings', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bindingsSnapshot: [{ type: 'workflow', name: 'ONBOARDING', workflow_name: 'onboarding', class_name: 'OnboardingWorkflow' }],
      bundleContent: `
        export default {
          async fetch(_request, env) {
            const instance = await env.ONBOARDING.create({ params: { plan: 'starter' } });
            const status = await instance.status();
            return Response.json({
              ok: true,
              instanceId: instance.id,
              status: status.status,
            });
          }
        };
      `,
    });

    const registry = await createLocalTenantWorkerRuntimeRegistry({
      dataDir: tempDataDir,
      db: env.DB,
      workerBundles: env.WORKER_BUNDLES,
      encryptionKey: env.ENCRYPTION_KEY,
    });

    try {
      const response = await registry.get('worker-demo').fetch('http://worker-demo/internal/state');
      const json = await response.json() as { ok: boolean; instanceId: string; status: string };
      assertEquals(json.ok, true);
      assertEquals(json.instanceId, /* expect.any(String) */ {} as any);
      assertEquals(json.status, 'queued');
    } finally {
      await registry.dispose();
    }
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - materializes canary worker bundles when routing selects a canary route ref', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_ROUTING_JSON', JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [
          { routeRef: 'worker-demo-v1', weight: 1, status: 'active' },
          { routeRef: 'worker-demo-v2', weight: 99, status: 'canary' },
        ],
      },
    }));

    const env = await createNodeWebEnv();
    const db = getDb(env.DB);
    await db.insert(accounts).values({
      id: 'space-demo',
      type: 'workspace',
      status: 'active',
      name: 'Space Demo',
      slug: 'space-demo',
    }).run();
    await db.insert(services).values({
      id: 'worker-demo',
      accountId: 'space-demo',
      serviceType: 'app',
      status: 'active',
      routeRef: 'worker-demo',
      activeDeploymentId: 'deployment-demo-v1',
    }).run();
    await db.insert(deployments).values([
      {
        id: 'deployment-demo-v1',
        serviceId: 'worker-demo',
        accountId: 'space-demo',
        version: 1,
        artifactRef: 'worker-demo-v1',
        bundleR2Key: 'deployments/worker-demo/1/bundle.js',
        runtimeConfigSnapshotJson: '{}',
        targetJson: JSON.stringify({ route_ref: 'worker-demo-v1' }),
        status: 'active',
        routingStatus: 'active',
        routingWeight: 1,
      },
      {
        id: 'deployment-demo-v2',
        serviceId: 'worker-demo',
        accountId: 'space-demo',
        version: 2,
        artifactRef: 'worker-demo-v2',
        bundleR2Key: 'deployments/worker-demo/2/bundle.js',
        runtimeConfigSnapshotJson: '{}',
        targetJson: JSON.stringify({ route_ref: 'worker-demo-v2' }),
        status: 'active',
        routingStatus: 'canary',
        routingWeight: 99,
      },
    ]).run();
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/1/bundle.js', `
      export default {
        async fetch() {
          return new Response(JSON.stringify({ worker: 'worker-demo-v1' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      };
    `);
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/2/bundle.js', `
      export default {
        async fetch() {
          return new Response(JSON.stringify({ worker: 'worker-demo-v2' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      };
    `);

    stub(Math, 'random') = (() => 0.99) as any;

    const fetch = await createLocalDispatchFetchForTests();
    const response = await fetch(new Request('http://hello.local/api/demo'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { worker: 'worker-demo-v2' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - materializes canary worker bundles when weighted targets share a stable service route ref', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_ROUTING_JSON', JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [
          { routeRef: 'worker-demo', deploymentId: 'deployment-demo-v1', weight: 1, status: 'active' },
          { routeRef: 'worker-demo', deploymentId: 'deployment-demo-v2', weight: 99, status: 'canary' },
        ],
      },
    }));

    const env = await createNodeWebEnv();
    const db = getDb(env.DB);
    await db.insert(accounts).values({
      id: 'space-demo',
      type: 'workspace',
      status: 'active',
      name: 'Space Demo',
      slug: 'space-demo',
    }).run();
    await db.insert(services).values({
      id: 'worker-demo',
      accountId: 'space-demo',
      serviceType: 'app',
      status: 'active',
      routeRef: 'worker-demo',
      activeDeploymentId: 'deployment-demo-v1',
    }).run();
    await db.insert(deployments).values([
      {
        id: 'deployment-demo-v1',
        serviceId: 'worker-demo',
        accountId: 'space-demo',
        version: 1,
        artifactRef: 'worker-demo-v1',
        bundleR2Key: 'deployments/worker-demo/1/bundle.js',
        runtimeConfigSnapshotJson: '{}',
        targetJson: JSON.stringify({ route_ref: 'worker-demo', endpoint: { kind: 'service-ref', ref: 'worker-demo' } }),
        status: 'active',
        routingStatus: 'active',
        routingWeight: 1,
      },
      {
        id: 'deployment-demo-v2',
        serviceId: 'worker-demo',
        accountId: 'space-demo',
        version: 2,
        artifactRef: 'worker-demo-v2',
        bundleR2Key: 'deployments/worker-demo/2/bundle.js',
        runtimeConfigSnapshotJson: '{}',
        targetJson: JSON.stringify({ route_ref: 'worker-demo', endpoint: { kind: 'service-ref', ref: 'worker-demo' } }),
        status: 'active',
        routingStatus: 'canary',
        routingWeight: 99,
      },
    ]).run();
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/1/bundle.js', `
      export default {
        async fetch() {
          return new Response(JSON.stringify({ worker: 'worker-demo-v1' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      };
    `);
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/2/bundle.js', `
      export default {
        async fetch() {
          return new Response(JSON.stringify({ worker: 'worker-demo-v2' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      };
    `);

    stub(Math, 'random') = (() => 0.99) as any;

    const fetch = await createLocalDispatchFetchForTests();
    const response = await fetch(new Request('http://hello.local/api/demo'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { worker: 'worker-demo-v2' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - re-resolves stable service route refs when the active deployment pointer changes', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_ROUTING_JSON', JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [{ routeRef: 'worker-demo', weight: 100, status: 'active' }],
      },
    }));

    const env = await createNodeWebEnv();
    const db = getDb(env.DB);
    await db.insert(accounts).values({
      id: 'space-demo',
      type: 'workspace',
      status: 'active',
      name: 'Space Demo',
      slug: 'space-demo',
    }).run();
    await db.insert(services).values({
      id: 'worker-demo',
      accountId: 'space-demo',
      serviceType: 'app',
      status: 'active',
      routeRef: 'worker-demo',
      activeDeploymentId: 'deployment-demo-v1',
    }).run();
    await db.insert(deployments).values([
      {
        id: 'deployment-demo-v1',
        serviceId: 'worker-demo',
        accountId: 'space-demo',
        version: 1,
        artifactRef: 'worker-demo-v1',
        bundleR2Key: 'deployments/worker-demo/1/bundle.js',
        runtimeConfigSnapshotJson: '{}',
        targetJson: JSON.stringify({ route_ref: 'worker-demo' }),
        status: 'active',
        routingStatus: 'active',
        routingWeight: 100,
      },
      {
        id: 'deployment-demo-v2',
        serviceId: 'worker-demo',
        accountId: 'space-demo',
        version: 2,
        artifactRef: 'worker-demo-v2',
        bundleR2Key: 'deployments/worker-demo/2/bundle.js',
        runtimeConfigSnapshotJson: '{}',
        targetJson: JSON.stringify({ route_ref: 'worker-demo' }),
        status: 'active',
        routingStatus: 'active',
        routingWeight: 100,
      },
    ]).run();
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/1/bundle.js', `
      export default {
        async fetch() {
          return new Response(JSON.stringify({ worker: 'worker-demo-v1' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      };
    `);
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/2/bundle.js', `
      export default {
        async fetch() {
          return new Response(JSON.stringify({ worker: 'worker-demo-v2' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      };
    `);

    const fetch = await createLocalDispatchFetchForTests();
    const firstResponse = await fetch(new Request('http://hello.local/api/demo'));
    assertEquals(firstResponse.status, 200);
    await assertEquals(await firstResponse.json(), { worker: 'worker-demo-v1' });

    await db.update(services)
      .set({ activeDeploymentId: 'deployment-demo-v2' })
      .where(eq(services.id, 'worker-demo'))
      .run();

    const secondResponse = await fetch(new Request('http://hello.local/api/demo'));
    assertEquals(secondResponse.status, 200);
    await assertEquals(await secondResponse.json(), { worker: 'worker-demo-v2' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - serves runtime-host in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalRuntimeHostFetchForTests();

    const response = await fetch(new Request('http://runtime-host/container/health'));

    assertEquals(response.status, 200);
    await assertEquals(await response.text(), 'ok');
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - serves runtime-host health in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalRuntimeHostFetchForTests();

    const response = await fetch(new Request('http://runtime-host/health'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { status: 'ok', service: 'takos-runtime-host' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - forwards runtime-host traffic to a configured runtime service', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_RUNTIME_URL', 'http://runtime.internal/base/');

    const upstreamFetch = async (request: Request) => {
      assertEquals(request.url, 'http://runtime.internal/base/health');
      return new Response('runtime-ok', { status: 200 });
    };

    (globalThis as any).fetch = upstreamFetch;

    const fetch = await createLocalRuntimeHostFetchForTests();
    const response = await fetch(new Request('http://runtime-host/container/health'));

    assertSpyCalls(upstreamFetch, 1);
    assertEquals(response.status, 200);
    await assertEquals(await response.text(), 'runtime-ok');
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - serves executor-host in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalExecutorHostFetchForTests();

    const response = await fetch(new Request('http://executor-host/'));

    assertEquals(response.status, 200);
    await assertEquals(await response.text(), 'takos-executor-host');
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - serves executor-host health in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalExecutorHostFetchForTests();

    const response = await fetch(new Request('http://executor-host/health'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { status: 'ok', service: 'takos-executor-host' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - forwards executor dispatch to a configured executor service with canonical control RPC fields', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_EXECUTOR_URL', 'http://executor.internal/base/');

    const upstreamFetch = async (request: Request) => {
      assertEquals(request.url, 'http://executor.internal/base/start');
      const body = await request.json() as Record<string, unknown>;
      assertEquals(body.runId, 'run-forward');
      assertEquals(body.workerId, 'worker-forward');
      assertEquals(typeof body.controlRpcToken, 'string');
      assertEquals(typeof body.controlRpcBaseUrl, 'string');
      return new Response(JSON.stringify({ status: 'accepted' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    (globalThis as any).fetch = upstreamFetch;

    const fetch = await createLocalExecutorHostFetchForTests();
    const response = await fetch(new Request('http://executor-host/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-forward',
        workerId: 'worker-forward',
      }),
    }));

    assertSpyCalls(upstreamFetch, 1);
    assertEquals(response.status, 202);
    await assertEquals(await response.json(), { status: 'accepted' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - serves browser-host in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalBrowserHostFetchForTests();

    const response = await fetch(new Request('http://browser-host/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-1',
        spaceId: 'space-1',
        userId: 'user-1',
      }),
    }));

    assertEquals(response.status, 201);
    await assertObjectMatch(await response.json(), { ok: true, proxyToken: /* expect.any(String) */ {} as any });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - serves browser-host health in local mode', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const fetch = await createLocalBrowserHostFetchForTests();

    const response = await fetch(new Request('http://browser-host/health'));

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { status: 'ok', service: 'takos-browser-host' });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - forwards browser bootstrap to a configured browser service', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  Deno.env.set('TAKOS_LOCAL_BROWSER_URL', 'http://browser.internal/base/');

    const upstreamFetch = async (request: Request) => {
      assertEquals(request.url, 'http://browser.internal/base/internal/bootstrap');
      const body = await request.json() as Record<string, unknown>;
      assertEquals(body.url, 'https://example.com');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    (globalThis as any).fetch = upstreamFetch;

    const fetch = await createLocalBrowserHostFetchForTests();
    const response = await fetch(new Request('http://browser-host/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-forward',
        spaceId: 'space-forward',
        userId: 'user-forward',
        url: 'https://example.com',
      }),
    }));

    assertSpyCalls(upstreamFetch, 1);
    assertEquals(response.status, 201);
    await assertObjectMatch(await response.json(), { ok: true, proxyToken: /* expect.any(String) */ {} as any });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})
  Deno.test('local bootstrap - persists sqlite, kv, and r2 state across adapter resets when a data dir is configured', async () => {
  Deno.env.set('ADMIN_DOMAIN', 'admin.local');
    Deno.env.set('TENANT_BASE_DOMAIN', 'tenant.local');
    Deno.env.delete('TAKOS_LOCAL_ROUTING_JSON');
    Deno.env.delete('TAKOS_LOCAL_DISPATCH_TARGETS_JSON');
    Deno.env.delete('TAKOS_LOCAL_RUNTIME_URL');
    Deno.env.delete('TAKOS_LOCAL_EXECUTOR_URL');
    Deno.env.delete('TAKOS_LOCAL_BROWSER_URL');
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    Deno.env.set('TAKOS_LOCAL_DATA_DIR', tempDataDir);
    Deno.env.delete('AWS_REGION');
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
    queueMocks.sqsSend;
    queueMocks.sqsSendBatch;
  try {
  const env = await createNodeWebEnv();
    await env.DB.exec('CREATE TABLE IF NOT EXISTS local_check (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
    await env.DB.prepare('INSERT INTO local_check (value) VALUES (?)').bind('persisted').run();
    await env.HOSTNAME_ROUTING.put('persist.local', 'tenant-app');
    await env.TAKOS_OFFLOAD?.put('artifacts/demo.txt', 'hello local');
    await env.RUN_QUEUE.send({
      version: RUN_QUEUE_MESSAGE_VERSION,
      runId: 'run-1',
      timestamp: 1710000000000,
      model: 'gpt-5-mini',
    });
    const notifierId = env.RUN_NOTIFIER.idFromName('run-1');
    env.RUN_NOTIFIER.get(notifierId);

    const queueFile = path.join(tempDataDir!, 'queues', 'run-queue.json');
    const notifierFile = path.join(tempDataDir!, 'durable-objects', 'run-notifier.json');
    const queueSnapshot = JSON.parse(await readFile(queueFile, 'utf8'));
    const notifierSnapshot = JSON.parse(await readFile(notifierFile, 'utf8'));

    await resetNodePlatformStateForTests();

    const reloaded = await createNodeWebEnv();
    const row = await reloaded.DB.prepare('SELECT value FROM local_check ORDER BY id DESC LIMIT 1').first<{ value: string }>();
    const reloadedQueueSnapshot = JSON.parse(await readFile(queueFile, 'utf8'));
    const reloadedNotifierSnapshot = JSON.parse(await readFile(notifierFile, 'utf8'));

    assertEquals(row, { value: 'persisted' });
    await assertEquals(await reloaded.HOSTNAME_ROUTING.get('persist.local'), 'tenant-app');
    await assertEquals(await reloaded.TAKOS_OFFLOAD?.get('artifacts/demo.txt')?.then((object) => object?.text()), 'hello local');
    assertEquals(queueSnapshot.messages.length, 1);
    assertObjectMatch(queueSnapshot.messages[0].body, { runId: 'run-1' });
    assertEquals(reloadedQueueSnapshot.messages.length, 1);
    assertStringIncludes(notifierSnapshot.ids, 'run-1');
    assertStringIncludes(reloadedNotifierSnapshot.ids, 'run-1');
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
    /* TODO: restore mocks manually */ void 0;
    /* TODO: restore stubbed globals manually */ void 0;
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  }
})