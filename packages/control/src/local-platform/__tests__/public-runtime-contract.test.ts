import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';

const controlRoot = import.meta.dirname;
const appRoot = path.resolve(controlRoot, '../../../../../apps/control');
const sourcePackageRoot = path.resolve(controlRoot, '../..');
const packageRoot = path.resolve(controlRoot, '../../../local-platform');
const repoRoot = path.resolve(controlRoot, '../../../../../');
const monorepoRootPackageJson = path.join(repoRoot, 'package.json');

async function read(relativePath: string, root = appRoot): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}


  Deno.test('local public runtime contract - keeps bootstrap and package runtime exports free of loader registration and shim imports', async () => {
  const bootstrap = await read('local-platform/bootstrap.ts', sourcePackageRoot);
    const sourceRuntime = await read('local-platform/runtime.ts', sourcePackageRoot);
    const sourceLocalServer = await read('local-platform/local-server.ts', sourcePackageRoot);
    const packageRuntime = await read('src/runtime.ts', packageRoot);
    const packageWeb = await read('src/web.ts', packageRoot);
    const packageDispatch = await read('src/dispatch.ts', packageRoot);
    const packageRuntimeHost = await read('src/runtime-host.ts', packageRoot);
    const packageExecutorHost = await read('src/executor-host.ts', packageRoot);
    const packageBrowserHost = await read('src/browser-host.ts', packageRoot);
    const packageWorker = await read('src/worker.ts', packageRoot);
    const packageOciOrchestrator = await read('src/oci-orchestrator.ts', packageRoot);

    for (const source of [
      bootstrap,
      sourceRuntime,
      packageRuntime,
      packageWeb,
      packageDispatch,
      packageRuntimeHost,
      packageExecutorHost,
      packageBrowserHost,
      packageWorker,
      packageOciOrchestrator,
    ]) {
      assert(!(source).includes('registerNodeResolveLoader'));
      assert(!(source).includes('node-resolve-loader'));
      assert(!(source).includes('register-loader'));
      assert(!(source).includes('cloudflare-workers-shim'));
      assert(!(source).includes('cloudflare-containers-shim'));
      assert(!(source).includes('miniflare-registry'));
      assert(!(source).includes('@cloudflare/containers'));
      assert(!(source).includes('./node-runtime.ts'));
      assert(!(source).includes('./http-server.ts'));
      assert(!(source).includes('./start-server.ts'));
    }

    // Source runtime.ts must stay free of Node server concerns
    assert(!(sourceRuntime).includes('startLocalFetchServer'));
    assert(!(sourceRuntime).includes('startLocalWebServer'));
    assert(!(sourceRuntime).includes('startLocalDispatchServer'));
    assert(!(sourceRuntime).includes('startLocalRuntimeHostServer'));
    assert(!(sourceRuntime).includes('startLocalExecutorHostServer'));
    assert(!(sourceRuntime).includes('startLocalBrowserHostServer'));
    assert(!(sourceRuntime).includes('fetch-server.ts'));

    // Server starters live in the canonical local-server.ts
    assertStringIncludes(sourceLocalServer, 'startCanonicalLocalServer');
    assertStringIncludes(sourceLocalServer, 'startLocalWebServer');
    assertStringIncludes(sourceLocalServer, 'startLocalDispatchServer');
    assertStringIncludes(sourceLocalServer, 'startLocalRuntimeHostServer');
    assertStringIncludes(sourceLocalServer, 'startLocalExecutorHostServer');
    assertStringIncludes(sourceLocalServer, 'startLocalBrowserHostServer');
    assertStringIncludes(sourceLocalServer, "runtime: 'node'");
    assertStringIncludes(sourceLocalServer, "from './fetch-server.ts'");

    // Package runtime wrapper is a pure re-export
    assertStringIncludes(packageRuntime, "from '../../src/local-platform/runtime.ts'");
    assertStringIncludes(packageRuntime, "from '../../src/local-platform/local-server.ts'");
    assert(!(packageRuntime).includes('fetch-server.ts'));

    const sourceFetchServer = await read('local-platform/fetch-server.ts', sourcePackageRoot);
    assert(!(sourceFetchServer).includes('process.env'));
    assert(!(sourceFetchServer).includes('logInfo'));
    assertStringIncludes(sourceFetchServer, "import('./node-fetch-server.ts')");
    assertStringIncludes(sourceFetchServer, 'serveNodeFetch');
})
  Deno.test('local public runtime contract - keeps Miniflare wiring behind the canonical tenant worker runtime factory', async () => {
  // The env builder (node-platform/env-builder.ts) is the canonical location
    // for binding creation.
    const envBuilder = await read('node-platform/env-builder.ts', sourcePackageRoot);
    const dispatchResolver = await read('node-platform/resolvers/dispatch-resolver.ts', sourcePackageRoot);
    const tenantRuntime = await read('local-platform/tenant-worker-runtime.ts', sourcePackageRoot);
    const servicesSchema = await read('infra/db/schema-services.ts', sourcePackageRoot);

    assertStringIncludes(envBuilder, "from '../local-platform/tenant-worker-runtime.ts'");
    assertStringIncludes(dispatchResolver, "from '../../local-platform/tenant-worker-runtime.ts'");
    assertStringIncludes(dispatchResolver, 'createLocalTenantWorkerRuntimeRegistry');
    assert(!(envBuilder).includes("path.join(shared.dataDir, 'miniflare'"));
    assert(!(envBuilder).includes('miniflare-registry'));
    assert(!(envBuilder).includes('createDebugMiniflareFetcherRegistry'));
    assert(!(envBuilder).includes('createLocalDebugTenantWorkerRuntimeRegistry'));
    assert(!(tenantRuntime).includes('TAKOS_LOCAL_DEBUG_TENANT_RUNTIME'));
    assertStringIncludes(tenantRuntime, "path.join(dataDir, 'tenant-runtime'");
    assertStringIncludes(tenantRuntime, "import('./miniflare-registry.ts')");
    assertStringIncludes(tenantRuntime, 'createLocalTenantRuntimeRegistry');
    assertStringIncludes(tenantRuntime, 'const loadRegistry = async (): Promise<TenantWorkerRuntimeRegistry> =>');
    assert(!(servicesSchema).includes('currentDeploymentId'));
    assert(!(servicesSchema).includes('previousDeploymentId'));
})
  Deno.test('local public runtime contract - publishes canonical local runtime entrypoints from the package', async () => {
  const localPlatformPackage = JSON.parse(await read('package.json', packageRoot)) as {
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
      exports?: Record<string, string>;
    };

    assertEquals(localPlatformPackage.bin, undefined);
    assertEquals(localPlatformPackage.exports?.['./web'], './src/web.ts');
    assertEquals(localPlatformPackage.exports?.['./dispatch'], './src/dispatch.ts');
    assertEquals(localPlatformPackage.exports?.['./runtime-host'], './src/runtime-host.ts');
    assertEquals(localPlatformPackage.exports?.['./executor-host'], './src/executor-host.ts');
    assertEquals(localPlatformPackage.exports?.['./browser-host'], './src/browser-host.ts');
    assertEquals(localPlatformPackage.exports?.['./worker'], './src/worker.ts');
    assertEquals(localPlatformPackage.exports?.['./oci-orchestrator'], './src/oci-orchestrator.ts');
    assertEquals(localPlatformPackage.exports?.['./run-public-entrypoint'], undefined);
    assertEquals(localPlatformPackage.exports?.['./register-loader'], undefined);
    assertEquals(localPlatformPackage.exports?.['./run-entrypoint'], undefined);
    assertEquals(localPlatformPackage.dependencies?.['takos-control-hosts'], undefined);
    assertEquals(localPlatformPackage.dependencies?.['@hono/node-server'], undefined);
    assertEquals(localPlatformPackage.dependencies?.['@cloudflare/containers'], undefined);
    assertEquals(localPlatformPackage.dependencies?.['takos-cloudflare-compat'], undefined);
    assertEquals(localPlatformPackage.dependencies?.miniflare, undefined);
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/web-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/dispatch-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/runtime-host-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/executor-host-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/browser-host-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/worker-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/oci-orchestrator-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/http-server.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/start-server.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/transport.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/direct-entrypoint.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/register-public-loader.mjs'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/register-loader.mjs'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/node-runtime.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(sourcePackageRoot, 'local-platform/run-entrypoint.mjs'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(sourcePackageRoot, 'local-platform/register-loader.mjs'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(sourcePackageRoot, 'local-platform/node-runtime.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(appRoot, 'src/web-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(appRoot, 'src/dispatch-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(appRoot, 'src/runtime-host-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(appRoot, 'src/executor-host-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(appRoot, 'src/browser-host-node.ts'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(appRoot, 'src/worker-node.ts'), constants.F_OK); });
})
  Deno.test('local public runtime contract - removes the public local runner shim entirely', async () => {
  await await assertRejects(async () => { await access(path.join(packageRoot, 'src/node-resolve-loader.mjs'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/cloudflare-workers-shim.mjs'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/cloudflare-containers-shim.mjs'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/public-resolve-loader.mjs'), constants.F_OK); });
    await await assertRejects(async () => { await access(path.join(packageRoot, 'src/run-public-entrypoint.mjs'), constants.F_OK); });
})
  Deno.test('local public runtime contract - routes compose and canonical scripts through direct package imports instead of CLI/bin indirection or *-node exports', async () => {
  const controlPackage = JSON.parse(await read('package.json')) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const monorepoPackage = JSON.parse(await readFile(monorepoRootPackageJson, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const compose = await read('compose.local.yml', repoRoot);

    function getCanonicalScript(scriptName: string): string {
      const script = controlPackage.scripts?.[scriptName];
      if (script !== undefined) {
        return script;
      }

      const alt = scriptName.startsWith('local:')
        ? `dev:${scriptName}`
        : (scriptName.startsWith('dev:local:')
          ? scriptName.replace('dev:', '')
          : undefined);
      if (alt && controlPackage.scripts?.[alt] !== undefined) {
        return controlPackage.scripts[alt]!;
      }

      return '';
    }

    for (const scriptName of [
      'local:web',
      'local:dispatch',
      'local:runtime-host',
      'local:executor-host',
      'local:browser-host',
      'local:worker',
      'local:oci-orchestrator',
      'local:run-smoke',
      'local:run-smoke-proxyless',
      'dev:local:web',
      'dev:local:dispatch',
      'dev:local:runtime-host',
      'dev:local:executor-host',
      'dev:local:browser-host',
      'dev:local:worker',
      'dev:local:oci-orchestrator',
      'dev:local:run-smoke',
      'dev:local:run-smoke-proxyless',
    ]) {
      const script = getCanonicalScript(scriptName);
      assert(script);
      assertStringIncludes(script, 'pnpm exec tsx ../../packages/control/local-platform/src/');
      assert(!(script).includes('--eval'));
      assert(!(script).includes('takos-control-local-platform/'));
      assert(!(script).includes('register-public-loader'));
      assert(!(script).includes('register-loader.mjs'));
      assert(!(script).includes('run-entrypoint.mjs'));
      assert(!(script).includes('run-public-entrypoint.mjs'));
    }
    assertEquals(controlPackage.dependencies?.['@hono/node-server'], undefined);
    assertEquals(controlPackage.dependencies?.['@cloudflare/containers'], undefined);

    assertStringIncludes(monorepoPackage.scripts?.['local:run-smoke'], 'pnpm dev:local:run-smoke');
    assertStringIncludes(monorepoPackage.scripts?.['local:proxyless-smoke'], 'pnpm dev:local:run-smoke-proxyless');

    assertStringIncludes(compose, '["pnpm", "local:web"]');
    assertStringIncludes(compose, '["pnpm", "local:dispatch"]');
    assertStringIncludes(compose, '["pnpm", "local:runtime-host"]');
    assertStringIncludes(compose, '["pnpm", "local:executor-host"]');
    assertStringIncludes(compose, '["pnpm", "local:browser-host"]');
    assertStringIncludes(compose, '["pnpm", "local:worker"]');
    assertStringIncludes(compose, '["pnpm", "local:oci-orchestrator"]');
    assert(!(compose).includes('dev:local:web:node'));
    assert(!(compose).includes('dev:local:dispatch:node'));
    assert(!(compose).includes('dev:local:runtime-host:node'));
    assert(!(compose).includes('dev:local:executor-host:node'));
    assert(!(compose).includes('dev:local:browser-host:node'));
    assert(!(compose).includes('dev:local:worker:node'));
    assert(!(compose).includes('dev:local:oci-orchestrator:node'));
})