import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLocalBrowserHostFetchForTests,
  createLocalDispatchFetchForTests,
  createLocalExecutorHostFetchForTests,
  createLocalRuntimeHostFetchForTests,
  createLocalWebFetchForTests,
} from './bootstrap';
import {
  clearNodePlatformDataForTests,
  createNodeWebEnv,
  resetNodePlatformStateForTests,
} from '../node-platform/env-builder';
import { createLocalTenantWorkerRuntimeRegistry } from './tenant-worker-runtime';
import type { WorkerBinding } from '../application/services/wfp/index.ts';
import { RUN_QUEUE_MESSAGE_VERSION } from '../shared/types/index.ts';
import { accounts, getDb, deployments } from '../infra/db/index.ts';
import { services } from '../infra/db/schema-services';
import { encrypt } from '../shared/utils/crypto.ts';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const localAdapterModuleUrl = pathToFileURL(path.join(
  repoRoot,
  'packages/control/src/node-platform/env-builder.ts',
)).href;
const runtimeModuleUrl = pathToFileURL(path.join(
  repoRoot,
  'packages/control/src/local-platform/runtime.ts',
)).href;
const dbIndexModuleUrl = pathToFileURL(path.join(
  repoRoot,
  'packages/control/src/infra/db/index.ts',
)).href;
const servicesSchemaModuleUrl = pathToFileURL(path.join(
  repoRoot,
  'packages/control/src/infra/db/schema-services.ts',
)).href;

async function runMiniflareDispatchSmoke(): Promise<{ status: number; body: unknown }> {
  const scriptDir = await mkdtemp(path.join(os.tmpdir(), 'takos-miniflare-smoke-'));
  const scriptPath = path.join(scriptDir, 'dispatch-smoke.mjs');
  const script = `
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createNodeWebEnv, clearNodePlatformDataForTests, resetNodePlatformStateForTests } from ${JSON.stringify(localAdapterModuleUrl)};
import { createLocalDispatchFetchForTests } from ${JSON.stringify(runtimeModuleUrl)};
import { accounts, deployments, getDb } from ${JSON.stringify(dbIndexModuleUrl)};
import { services } from ${JSON.stringify(servicesSchemaModuleUrl)};

async function main() {
  process.env.ADMIN_DOMAIN = 'admin.local';
  process.env.TENANT_BASE_DOMAIN = 'tenant.local';
  process.env.TAKOS_LOCAL_ROUTING_JSON = JSON.stringify({
    'hello.local': {
      type: 'deployments',
      deployments: [{ routeRef: 'worker-demo-v1', weight: 100, status: 'active' }],
    },
  });

  const tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-child-'));
  process.env.TAKOS_LOCAL_DATA_DIR = tempDataDir;
  await clearNodePlatformDataForTests();
  await resetNodePlatformStateForTests();

  try {
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
    await env.WORKER_BUNDLES?.put('deployments/worker-demo/1/bundle.js', \`
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
    \`);

    const fetch = await createLocalDispatchFetchForTests();
    const response = await fetch(new Request('http://hello.local/api/demo'));
    console.log(JSON.stringify({
      status: response.status,
      body: await response.json(),
    }));
  } finally {
    await resetNodePlatformStateForTests();
    await rm(tempDataDir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;

  await writeFile(scriptPath, script, 'utf8');

  try {
    const env = { ...process.env };
    delete env.VITEST;
    delete env.VITEST_POOL_ID;
    delete env.VITEST_WORKER_ID;

    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx/esm', scriptPath],
      {
        cwd: repoRoot,
        env,
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
    );

    const output = stdout.trim().split('\n').at(-1);
    if (!output) {
      throw new Error('Miniflare smoke child process produced no output');
    }
    return JSON.parse(output) as { status: number; body: unknown };
  } finally {
    await rm(scriptDir, { recursive: true, force: true });
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
  const encryptionKey = env.ENCRYPTION_KEY ?? 'local-encryption-key';
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

describe('local bootstrap', () => {
  const originalEnv = {
    ADMIN_DOMAIN: process.env.ADMIN_DOMAIN,
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
    TAKOS_LOCAL_ROUTING_JSON: process.env.TAKOS_LOCAL_ROUTING_JSON,
    TAKOS_LOCAL_DISPATCH_TARGETS_JSON: process.env.TAKOS_LOCAL_DISPATCH_TARGETS_JSON,
    TAKOS_LOCAL_DATA_DIR: process.env.TAKOS_LOCAL_DATA_DIR,
    TAKOS_LOCAL_RUNTIME_URL: process.env.TAKOS_LOCAL_RUNTIME_URL,
    TAKOS_LOCAL_EXECUTOR_URL: process.env.TAKOS_LOCAL_EXECUTOR_URL,
    TAKOS_LOCAL_BROWSER_URL: process.env.TAKOS_LOCAL_BROWSER_URL,
  };
  let tempDataDir: string | null = null;

  beforeEach(async () => {
    process.env.ADMIN_DOMAIN = 'admin.local';
    process.env.TENANT_BASE_DOMAIN = 'tenant.local';
    delete process.env.TAKOS_LOCAL_ROUTING_JSON;
    delete process.env.TAKOS_LOCAL_DISPATCH_TARGETS_JSON;
    delete process.env.TAKOS_LOCAL_RUNTIME_URL;
    delete process.env.TAKOS_LOCAL_EXECUTOR_URL;
    delete process.env.TAKOS_LOCAL_BROWSER_URL;
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'takos-local-test-'));
    process.env.TAKOS_LOCAL_DATA_DIR = tempDataDir;
    await clearNodePlatformDataForTests();
    await resetNodePlatformStateForTests();
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await resetNodePlatformStateForTests();
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
    }
  });

  it('serves takos-web health without Cloudflare bindings', async () => {
    const fetch = await createLocalWebFetchForTests();

    const response = await fetch(new Request('http://admin.local/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('does not synthesize fake Cloudflare credentials in local mode', async () => {
    const env = await createNodeWebEnv();

    expect(env.CF_ACCOUNT_ID).toBeUndefined();
    expect(env.CF_API_TOKEN).toBeUndefined();
    expect(env.WFP_DISPATCH_NAMESPACE).toBeUndefined();
    expect(env.CF_ZONE_ID).toBeUndefined();
  });

  it('allows loopback health checks in local mode', async () => {
    const fetch = await createLocalWebFetchForTests();

    const response = await fetch(new Request('http://127.0.0.1/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('allows compose-internal health checks in local mode', async () => {
    const fetch = await createLocalWebFetchForTests();

    const response = await fetch(new Request('http://control-web/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('returns 503 when dispatch routing resolves to an unconfigured worker target', async () => {
    process.env.TAKOS_LOCAL_ROUTING_JSON = JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [{ routeRef: 'tenant-app', weight: 100, status: 'active' }],
      },
    });
    const fetch = await createLocalDispatchFetchForTests();

    const response = await fetch(new Request('http://hello.local/runs'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: 'Tenant worker not found',
      message: 'The tenant worker may be provisioning or has been deleted',
    }));
  });

  it('serves dispatch health in local mode', async () => {
    const fetch = await createLocalDispatchFetchForTests();

    const response = await fetch(new Request('http://dispatch.local/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'takos-dispatch' });
  });

  it('rejects tenant worker URL overrides in local dispatch config', async () => {
    process.env.TAKOS_LOCAL_DISPATCH_TARGETS_JSON = JSON.stringify({
      'tenant-app': 'http://worker.internal/base/',
    });

    await expect(createLocalDispatchFetchForTests()).rejects.toThrow(
      /TAKOS_LOCAL_DISPATCH_TARGETS_JSON may only override infra service targets/,
    );
  });

  it('forwards dispatch traffic to http-endpoint-set URL targets', async () => {
    process.env.TAKOS_LOCAL_ROUTING_JSON = JSON.stringify({
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
    });

    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('http://worker.internal/base/api/runs?view=full');
      expect(request.headers.get('X-Forwarded-Host')).toBe('hello.local');
      expect(request.headers.get('X-Tenant-Endpoint')).toBe('oci-public');
      expect(request.headers.get('X-Tenant-Worker')).toBeNull();
      return new Response('ok-url', { status: 200 });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const fetch = await createLocalDispatchFetchForTests();
    const response = await fetch(new Request('http://hello.local/api/runs?view=full'));

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('ok-url');
  });

  it('dispatches to a locally materialized tenant worker via Miniflare when no URL target is configured', async () => {
    const response = await runMiniflareDispatchSmoke();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      worker: 'worker-demo-v1',
      path: '/api/demo',
    });
  });

  it('materializes tenant workers by default when no URL target is configured', async () => {
    process.env.TAKOS_LOCAL_ROUTING_JSON = JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [{ routeRef: 'worker-demo-v1', weight: 100, status: 'active' }],
      },
    });

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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      worker: 'worker-demo-v1',
      path: '/api/demo',
    });
  });

  it('dispatches scheduled events through the canonical local tenant runtime registry', async () => {
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

      expect(scheduledResult).toMatchObject({
        outcome: expect.any(String),
        noRetry: expect.any(Boolean),
      });

      const response = await registry.get('worker-demo').fetch('http://worker-demo/internal/state');
      await expect(response.json()).resolves.toEqual({
        lastScheduled: {
          cron: '0 * * * *',
          scheduledTime: Date.parse('2026-03-25T00:00:00.000Z'),
        },
      });
    } finally {
      await registry.dispose();
    }
  });

  it('dispatches queue events through the canonical local tenant runtime registry', async () => {
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

      expect(queueResult).toMatchObject({
        outcome: expect.any(String),
        ackAll: expect.any(Boolean),
      });

      const response = await registry.get('worker-demo').fetch('http://worker-demo/internal/state');
      await expect(response.json()).resolves.toEqual({
        lastQueue: {
          queue: 'tenant-jobs',
          ids: ['msg-1', 'msg-2'],
          values: ['alpha', 'beta'],
        },
      });
    } finally {
      await registry.dispose();
    }
  });

  it('dispatches scheduled events against the selected deployment when stable route refs share a service name', async () => {
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
      await expect(canaryResponse.json()).resolves.toEqual({
        worker: 'worker-demo-v2',
        lastScheduled: { worker: 'worker-demo-v2', cron: '*/5 * * * *' },
      });

      const activeResponse = await registry.get('worker-demo', { deploymentId: 'deployment-demo-v1' }).fetch('http://worker-demo/internal/state');
      await expect(activeResponse.json()).resolves.toEqual({
        worker: 'worker-demo-v1',
        lastScheduled: null,
      });
    } finally {
      await registry.dispose();
    }
  });

  it('dispatches queue events against the selected deployment when stable route refs share a service name', async () => {
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
      await expect(canaryResponse.json()).resolves.toEqual({
        worker: 'worker-demo-v2',
        lastQueue: { worker: 'worker-demo-v2', queue: 'tenant-jobs', ids: ['msg-canary'] },
      });

      const activeResponse = await registry.get('worker-demo', { deploymentId: 'deployment-demo-v1' }).fetch('http://worker-demo/internal/state');
      await expect(activeResponse.json()).resolves.toEqual({
        worker: 'worker-demo-v1',
        lastQueue: null,
      });
    } finally {
      await registry.dispose();
    }
  });

  it('fails fast when local tenant workflow invocation is requested', async () => {
    const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
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
      await expect(
        registry.invokeWorkflow('worker-demo', { exportName: 'runWorkflow', payload: { job: 'demo' } }),
      ).rejects.toThrow(/workflow runtime is not implemented yet/i);
    } finally {
      await registry.dispose();
    }
  });

  it('rejects deployment ids that do not belong to the requested tenant worker', async () => {
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
      await expect(
        registry.get('worker-beta', { deploymentId: 'deployment-alpha-v1' }).fetch('http://worker-beta/internal/state'),
      ).rejects.toThrow(/does not belong to local tenant worker worker-beta/i);
    } finally {
      await registry.dispose();
    }
  });

  it('materializes local tenant queue producer bindings', async () => {
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
      await expect(response.json()).resolves.toEqual({
        ok: true,
        hasSend: true,
      });
    } finally {
      await registry.dispose();
    }
  });

  it('materializes local tenant durable object bindings', async () => {
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
      await expect(response.json()).resolves.toEqual({
        ok: true,
        path: '/internal/state',
      });
    } finally {
      await registry.dispose();
    }
  });

  it('fails fast when local tenant analytics engine bindings are present', async () => {
    const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bindingsSnapshot: [{ type: 'analytics_engine', name: 'EVENTS', dataset: 'tenant_events' }],
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
      await expect(
        registry.get('worker-demo').fetch('http://worker-demo/internal/state'),
      ).rejects.toThrow(/does not support analytics engine bindings yet/i);
    } finally {
      await registry.dispose();
    }
  });

  it('fails fast when local tenant workflow bindings are present', async () => {
    const env = await createNodeWebEnv();
    await seedTenantWorkerBundle({
      env,
      bindingsSnapshot: [{ type: 'workflow', name: 'ONBOARDING', workflow_name: 'onboarding', class_name: 'OnboardingWorkflow' }],
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
      await expect(
        registry.get('worker-demo').fetch('http://worker-demo/internal/state'),
      ).rejects.toThrow(/does not support workflow bindings yet/i);
    } finally {
      await registry.dispose();
    }
  });

  it('materializes canary worker bundles when routing selects a canary route ref', async () => {
    process.env.TAKOS_LOCAL_ROUTING_JSON = JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [
          { routeRef: 'worker-demo-v1', weight: 1, status: 'active' },
          { routeRef: 'worker-demo-v2', weight: 99, status: 'canary' },
        ],
      },
    });

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

    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    const fetch = await createLocalDispatchFetchForTests();
    const response = await fetch(new Request('http://hello.local/api/demo'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ worker: 'worker-demo-v2' });
  });

  it('materializes canary worker bundles when weighted targets share a stable service route ref', async () => {
    process.env.TAKOS_LOCAL_ROUTING_JSON = JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [
          { routeRef: 'worker-demo', deploymentId: 'deployment-demo-v1', weight: 1, status: 'active' },
          { routeRef: 'worker-demo', deploymentId: 'deployment-demo-v2', weight: 99, status: 'canary' },
        ],
      },
    });

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

    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    const fetch = await createLocalDispatchFetchForTests();
    const response = await fetch(new Request('http://hello.local/api/demo'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ worker: 'worker-demo-v2' });
  });

  it('re-resolves stable service route refs when the active deployment pointer changes', async () => {
    process.env.TAKOS_LOCAL_ROUTING_JSON = JSON.stringify({
      'hello.local': {
        type: 'deployments',
        deployments: [{ routeRef: 'worker-demo', weight: 100, status: 'active' }],
      },
    });

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
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({ worker: 'worker-demo-v1' });

    await db.update(services)
      .set({ activeDeploymentId: 'deployment-demo-v2' })
      .where(eq(services.id, 'worker-demo'))
      .run();

    const secondResponse = await fetch(new Request('http://hello.local/api/demo'));
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({ worker: 'worker-demo-v2' });
  });

  it('serves runtime-host in local mode', async () => {
    const fetch = await createLocalRuntimeHostFetchForTests();

    const response = await fetch(new Request('http://runtime-host/container/health'));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('ok');
  });

  it('serves runtime-host health in local mode', async () => {
    const fetch = await createLocalRuntimeHostFetchForTests();

    const response = await fetch(new Request('http://runtime-host/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'takos-runtime-host' });
  });

  it('forwards runtime-host traffic to a configured runtime service', async () => {
    process.env.TAKOS_LOCAL_RUNTIME_URL = 'http://runtime.internal/base/';

    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('http://runtime.internal/base/health');
      return new Response('runtime-ok', { status: 200 });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const fetch = await createLocalRuntimeHostFetchForTests();
    const response = await fetch(new Request('http://runtime-host/container/health'));

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('runtime-ok');
  });

  it('serves executor-host in local mode', async () => {
    const fetch = await createLocalExecutorHostFetchForTests();

    const response = await fetch(new Request('http://executor-host/'));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('takos-executor-host');
  });

  it('serves executor-host health in local mode', async () => {
    const fetch = await createLocalExecutorHostFetchForTests();

    const response = await fetch(new Request('http://executor-host/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'takos-executor-host' });
  });

  it('forwards executor dispatch to a configured executor service with canonical control RPC fields', async () => {
    process.env.TAKOS_LOCAL_EXECUTOR_URL = 'http://executor.internal/base/';

    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('http://executor.internal/base/start');
      const body = await request.json() as Record<string, unknown>;
      expect(body.runId).toBe('run-forward');
      expect(body.workerId).toBe('worker-forward');
      expect(typeof body.controlRpcToken).toBe('string');
      expect(typeof body.controlRpcBaseUrl).toBe('string');
      return new Response(JSON.stringify({ status: 'accepted' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const fetch = await createLocalExecutorHostFetchForTests();
    const response = await fetch(new Request('http://executor-host/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-forward',
        workerId: 'worker-forward',
      }),
    }));

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'accepted' });
  });

  it('serves browser-host in local mode', async () => {
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

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true, proxyToken: expect.any(String) });
  });

  it('serves browser-host health in local mode', async () => {
    const fetch = await createLocalBrowserHostFetchForTests();

    const response = await fetch(new Request('http://browser-host/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'takos-browser-host' });
  });

  it('forwards browser bootstrap to a configured browser service', async () => {
    process.env.TAKOS_LOCAL_BROWSER_URL = 'http://browser.internal/base/';

    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('http://browser.internal/base/internal/bootstrap');
      const body = await request.json() as Record<string, unknown>;
      expect(body.url).toBe('https://example.com');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', upstreamFetch);

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

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true, proxyToken: expect.any(String) });
  });

  it('persists sqlite, kv, and r2 state across adapter resets when a data dir is configured', async () => {
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

    expect(row).toEqual({ value: 'persisted' });
    await expect(reloaded.HOSTNAME_ROUTING.get('persist.local')).resolves.toBe('tenant-app');
    await expect(reloaded.TAKOS_OFFLOAD?.get('artifacts/demo.txt')?.then((object) => object?.text())).resolves.toBe('hello local');
    expect(queueSnapshot.messages).toHaveLength(1);
    expect(queueSnapshot.messages[0].body).toMatchObject({ runId: 'run-1' });
    expect(reloadedQueueSnapshot.messages).toHaveLength(1);
    expect(notifierSnapshot.ids).toContain('run-1');
    expect(reloadedNotifierSnapshot.ids).toContain('run-1');
  });
});
