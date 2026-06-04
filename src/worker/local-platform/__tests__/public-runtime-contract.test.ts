import { test } from "bun:test";
import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { assert, assertEquals, assertRejects, assertStringIncludes } from '@takos/test/assert';

const controlRoot = import.meta.dirname!;
const takosRoot = path.resolve(controlRoot, '../../../..');
const sourcePackageRoot = path.join(takosRoot, 'src/worker');
const appRoot = sourcePackageRoot;

function read(relativePath: string, root = appRoot): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

function assertSourceMatches(source: string, pattern: RegExp): void {
  assert(
    pattern.test(source),
    `Expected source to match ${pattern}`,
  );
}

test(
  'local public runtime contract - keeps bootstrap and local runtime exports free of loader registration and shim imports',
  async () => {
    const sourceRuntime = await read(
      'local-platform/runtime.ts',
      sourcePackageRoot,
    );
    const sourceLocalServer = await read(
      'local-platform/local-server.ts',
      sourcePackageRoot,
    );
    const sourceWorker = await read(
      'local-platform/worker.ts',
      sourcePackageRoot,
    );
    const sourceIndex = await read(
      'local-platform/index.ts',
      sourcePackageRoot,
    );
    const sourceUnifiedEntrypoint = await read(
      'local-platform/unified-entrypoint.ts',
      sourcePackageRoot,
    );

    for (
      const source of [
        sourceRuntime,
        sourceWorker,
        sourceIndex,
        sourceUnifiedEntrypoint,
      ]
    ) {
      assert(!source.includes('registerNodeResolveLoader'));
      assert(!source.includes('node-resolve-loader'));
      assert(!source.includes('register-loader'));
      assert(!source.includes('cloudflare-workers-shim'));
      assert(!source.includes('cloudflare-containers-shim'));
      assert(!source.includes('miniflare-registry'));
      assert(!source.includes('@cloudflare/containers'));
      assert(!source.includes('./node-runtime.ts'));
      assert(!source.includes('./http-server.ts'));
      assert(!source.includes('./start-server.ts'));
    }

    assert(!sourceRuntime.includes('startLocalFetchServer'));
    assert(!sourceRuntime.includes('startLocalWebServer'));
    assert(!sourceRuntime.includes('startLocalDispatchServer'));
    assert(!sourceRuntime.includes('startLocalRuntimeHostServer'));
    assert(!sourceRuntime.includes('startLocalExecutorHostServer'));
    assert(!sourceRuntime.includes('fetch-server.ts'));

    assertStringIncludes(sourceLocalServer, 'startCanonicalLocalServer');
    assertStringIncludes(sourceLocalServer, 'startLocalWebServer');
    assertStringIncludes(sourceLocalServer, 'startLocalDispatchServer');
    assertStringIncludes(sourceLocalServer, 'startLocalRuntimeHostServer');
    assertStringIncludes(sourceLocalServer, 'startLocalExecutorHostServer');
    assertStringIncludes(sourceLocalServer, 'runtime: "node"');
    assertStringIncludes(sourceLocalServer, 'from "./fetch-server.ts"');
    assertStringIncludes(sourceIndex, 'export * from "./runtime.ts"');
    assertStringIncludes(sourceUnifiedEntrypoint, 'startUnifiedTakosWorker');

    const sourceFetchServer = await read(
      'local-platform/fetch-server.ts',
      sourcePackageRoot,
    );
    assert(!sourceFetchServer.includes('process.env'));
    assert(!sourceFetchServer.includes('logInfo'));
    assertSourceMatches(
      sourceFetchServer,
      /import\(["']\.\/node-fetch-server\.ts["']\)/,
    );
    assertStringIncludes(sourceFetchServer, 'serveNodeFetch');
  },
);

test('local public runtime contract - keeps Miniflare wiring behind the canonical tenant workload runtime factory', async () => {
  const envBuilder = await read(
    'node-platform/env-builder.ts',
    sourcePackageRoot,
  );
  const dispatchResolver = await read(
    'node-platform/resolvers/dispatch-resolver.ts',
    sourcePackageRoot,
  );
  const tenantRuntime = await read(
    'local-platform/tenant-worker-runtime.ts',
    sourcePackageRoot,
  );
  const servicesSchema = await read(
    'infra/db/schema-services.ts',
    sourcePackageRoot,
  );

  assertStringIncludes(
    envBuilder,
    'from "../local-platform/tenant-worker-runtime.ts"',
  );
  assertStringIncludes(
    dispatchResolver,
    'from "../../local-platform/tenant-worker-runtime.ts"',
  );
  assertStringIncludes(
    dispatchResolver,
    'createLocalTenantWorkerRuntimeRegistry',
  );
  assert(!envBuilder.includes("path.join(shared.dataDir, 'miniflare'"));
  assert(!envBuilder.includes('miniflare-registry'));
  assert(!envBuilder.includes('createDebugMiniflareFetcherRegistry'));
  assert(!envBuilder.includes('createLocalDebugTenantWorkerRuntimeRegistry'));
  assert(!tenantRuntime.includes('TAKOS_LOCAL_DEBUG_TENANT_RUNTIME'));
  assertStringIncludes(tenantRuntime, 'path.join(dataDir, "tenant-runtime"');
  assertStringIncludes(tenantRuntime, 'import("./miniflare-registry.ts")');
  assertStringIncludes(tenantRuntime, 'createLocalTenantRuntimeRegistry');
  assertStringIncludes(
    tenantRuntime,
    'const loadRegistry = async (): Promise<TenantWorkerRuntimeRegistry> =>',
  );
  assert(!servicesSchema.includes('currentDeploymentId'));
  assert(!servicesSchema.includes('previousDeploymentId'));
});

test('local public runtime contract - publishes canonical local runtime entrypoints from src/worker', async () => {
  const rootPackage = JSON.parse(await readFile(path.join(takosRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assertStringIncludes(
    rootPackage.scripts?.dev ?? '',
    'bun src/worker/local-platform/unified-entrypoint.ts',
  );
  assertStringIncludes(
    rootPackage.scripts?.['dev:api'] ?? '',
    'src/worker/local-platform/unified-entrypoint.ts',
  );
  assertStringIncludes(
    rootPackage.scripts?.['dev:worker'] ?? '',
    'src/worker/local-platform/unified-entrypoint.ts',
  );
  assertStringIncludes(
    await read('local-platform/unified-entrypoint.ts', sourcePackageRoot),
    'startUnifiedTakosWorker',
  );

  await assertRejects(() => access(path.join(takosRoot, 'src/local-platform'), constants.F_OK));
  await assertRejects(() => access(path.join(sourcePackageRoot, 'local-platform-entrypoints'), constants.F_OK));
  await assertRejects(() =>
    access(
      path.join(sourcePackageRoot, 'local-platform/run-entrypoint.mjs'),
      constants.F_OK,
    )
  );
  await assertRejects(() =>
    access(
      path.join(sourcePackageRoot, 'local-platform/register-loader.mjs'),
      constants.F_OK,
    )
  );
  await assertRejects(() =>
    access(
      path.join(sourcePackageRoot, 'local-platform/node-runtime.ts'),
      constants.F_OK,
    )
  );
  await assertRejects(() => access(path.join(appRoot, 'src/web-node.ts'), constants.F_OK));
  await assertRejects(() => access(path.join(appRoot, 'src/dispatch-node.ts'), constants.F_OK));
  await assertRejects(() => access(path.join(appRoot, 'src/runtime-host-node.ts'), constants.F_OK));
  await assertRejects(() => access(path.join(appRoot, 'src/executor-host-node.ts'), constants.F_OK));
  await assertRejects(() => access(path.join(appRoot, 'src/browser-host-node.ts'), constants.F_OK));
  await assertRejects(() => access(path.join(appRoot, 'src/worker-node.ts'), constants.F_OK));
});

test('local public runtime contract - removes the public local runner shim entirely', async () => {
  const removedShims = [
    'node-resolve-loader.mjs',
    'cloudflare-workers-shim.mjs',
    'cloudflare-containers-shim.mjs',
    'public-resolve-loader.mjs',
    'run-public-entrypoint.mjs',
  ];
  // The shims previously lived at src/<name>.mjs. They were briefly moved into
  // src/local-platform/<name>.mjs before deletion, so the contract now covers
  // both locations to keep them from quietly resurfacing in either spot.
  for (const shim of removedShims) {
    await assertRejects(() => access(path.join(sourcePackageRoot, shim), constants.F_OK));
    await assertRejects(() =>
      access(
        path.join(sourcePackageRoot, 'local-platform', shim),
        constants.F_OK,
      )
    );
  }

  await assertRejects(() =>
    access(
      path.join(sourcePackageRoot, 'local-platform', 'bootstrap.ts'),
      constants.F_OK,
    )
  );
});

test(
  'local public runtime contract - routes compose and canonical scripts through direct package imports instead of bin indirection or *-node exports',
  async () => {
    const rootPackage = JSON.parse(
      await readFile(path.join(takosRoot, 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const compose = await read('compose.local.yml', takosRoot);

    assertStringIncludes(
      rootPackage.scripts?.['local:up'] ?? '',
      'compose.local.yml',
    );
    assertStringIncludes(
      rootPackage.scripts?.['local:down'] ?? '',
      'compose.local.yml',
    );
    assert(!JSON.stringify(rootPackage.scripts ?? {}).includes('local-platform-entrypoints'));
    assert(!JSON.stringify(rootPackage.scripts ?? {}).includes('takos-worker-local-platform'));
    assertEquals(rootPackage.dependencies?.['@hono/node-server'], undefined);

    assertStringIncludes(compose, "command: ['bun', 'run', 'dev']");
    assertStringIncludes(compose, "command: ['bun', 'run', 'dev']");
    assertStringIncludes(compose, "command: ['bun', 'src/all/server.ts']");
    assertStringIncludes(compose, 'context: ..');
    assertStringIncludes(compose, 'dockerfile: takos/containers/agent/Dockerfile');
    assert(!compose.includes('dev:local:web'));
    assert(!compose.includes('dev:local:dispatch'));
    assert(!compose.includes('dev:local:runtime-host'));
    assert(!compose.includes('dev:local:executor-host'));
    assert(!compose.includes('dev:local:browser-host'));
    assert(!compose.includes('dev:local:worker'));
    assert(!compose.includes('dev:local:oci-orchestrator'));
    assert(!compose.includes('dev:local:web:node'));
    assert(!compose.includes('dev:local:dispatch:node'));
    assert(!compose.includes('dev:local:runtime-host:node'));
    assert(!compose.includes('dev:local:executor-host:node'));
    assert(!compose.includes('dev:local:browser-host:node'));
    assert(!compose.includes('dev:local:worker:node'));
    assert(!compose.includes('dev:local:oci-orchestrator:node'));
  },
);
