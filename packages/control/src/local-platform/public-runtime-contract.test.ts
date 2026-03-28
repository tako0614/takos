import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const controlRoot = import.meta.dirname;
const appRoot = path.resolve(controlRoot, '../../../../apps/control');
const sourcePackageRoot = path.resolve(controlRoot, '..');
const packageRoot = path.resolve(controlRoot, '../../local-platform');
const repoRoot = path.resolve(controlRoot, '../../../../');
const monorepoRootPackageJson = path.join(repoRoot, 'package.json');

async function read(relativePath: string, root = appRoot): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

describe('local public runtime contract', () => {
  it('keeps bootstrap and package runtime exports free of loader registration and shim imports', async () => {
    const bootstrap = await read('local-platform/bootstrap.ts', sourcePackageRoot);
    const sourceRuntime = await read('local-platform/runtime.ts', sourcePackageRoot);
    const packageRuntime = await read('src/runtime.ts', packageRoot);
    const packageTransport = await read('src/transport.ts', packageRoot);
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
      expect(source).not.toContain('registerNodeResolveLoader');
      expect(source).not.toContain('node-resolve-loader');
      expect(source).not.toContain('register-loader');
      expect(source).not.toContain('cloudflare-workers-shim');
      expect(source).not.toContain('cloudflare-containers-shim');
      expect(source).not.toContain('miniflare-registry');
      expect(source).not.toContain('@cloudflare/containers');
      expect(source).not.toContain('./node-runtime.ts');
      expect(source).not.toContain('./http-server.ts');
      expect(source).not.toContain('./start-server.ts');
      expect(source).not.toContain('fetch-server.ts');
    }

    expect(sourceRuntime).not.toContain('startLocalFetchServer');
    expect(sourceRuntime).not.toContain('startLocalWebServer');
    expect(sourceRuntime).not.toContain('startLocalDispatchServer');
    expect(sourceRuntime).not.toContain('startLocalRuntimeHostServer');
    expect(sourceRuntime).not.toContain('startLocalExecutorHostServer');
    expect(sourceRuntime).not.toContain('startLocalBrowserHostServer');
    expect(packageRuntime).toContain('startCanonicalLocalServer');
    expect(packageRuntime).not.toContain('fetch-server.ts');
    expect(packageTransport).not.toContain('TAKOS_LOCAL_FETCH_TRANSPORT');
    expect(packageTransport).toContain("runtime: 'node'");
    expect(packageTransport).toContain("from '../../src/local-platform/fetch-server.ts'");
    const sourceFetchServer = await read('local-platform/fetch-server.ts', sourcePackageRoot);
    expect(sourceFetchServer).not.toContain('process.env');
    expect(sourceFetchServer).not.toContain('logInfo');
    expect(sourceFetchServer).toContain("import('./node-fetch-server.ts')");
    expect(sourceFetchServer).toContain('serveNodeFetch');
  });

  it('keeps Miniflare wiring behind the canonical tenant worker runtime factory', async () => {
    // The env builder (node-platform/env-builder.ts) is the canonical location
    // for binding creation.
    const envBuilder = await read('node-platform/env-builder.ts', sourcePackageRoot);
    const tenantRuntime = await read('local-platform/tenant-worker-runtime.ts', sourcePackageRoot);
    const servicesSchema = await read('infra/db/schema-services.ts', sourcePackageRoot);

    expect(envBuilder).toContain("from '../local-platform/tenant-worker-runtime.ts'");
    expect(envBuilder).toContain('createLocalTenantWorkerRuntimeRegistry');
    expect(envBuilder).not.toContain("path.join(shared.dataDir, 'miniflare'");
    expect(envBuilder).not.toContain('miniflare-registry');
    expect(envBuilder).not.toContain('createDebugMiniflareFetcherRegistry');
    expect(envBuilder).not.toContain('createLocalDebugTenantWorkerRuntimeRegistry');
    expect(tenantRuntime).not.toContain('TAKOS_LOCAL_DEBUG_TENANT_RUNTIME');
    expect(tenantRuntime).toContain("path.join(dataDir, 'tenant-runtime'");
    expect(tenantRuntime).toContain("import('./miniflare-registry.ts')");
    expect(tenantRuntime).toContain('createLocalTenantRuntimeRegistry');
    expect(tenantRuntime).toContain('const loadRegistry = async (): Promise<TenantWorkerRuntimeRegistry> =>');
    expect(servicesSchema).not.toContain('currentDeploymentId');
    expect(servicesSchema).not.toContain('previousDeploymentId');
  });

  it('publishes canonical local runtime entrypoints from the package', async () => {
    const localPlatformPackage = JSON.parse(await read('package.json', packageRoot)) as {
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
      exports?: Record<string, string>;
    };

    expect(localPlatformPackage.bin).toBeUndefined();
    expect(localPlatformPackage.exports?.['./web']).toBe('./src/web.ts');
    expect(localPlatformPackage.exports?.['./dispatch']).toBe('./src/dispatch.ts');
    expect(localPlatformPackage.exports?.['./runtime-host']).toBe('./src/runtime-host.ts');
    expect(localPlatformPackage.exports?.['./executor-host']).toBe('./src/executor-host.ts');
    expect(localPlatformPackage.exports?.['./browser-host']).toBe('./src/browser-host.ts');
    expect(localPlatformPackage.exports?.['./worker']).toBe('./src/worker.ts');
    expect(localPlatformPackage.exports?.['./oci-orchestrator']).toBe('./src/oci-orchestrator.ts');
    expect(localPlatformPackage.exports?.['./run-public-entrypoint']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./register-loader']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./run-entrypoint']).toBeUndefined();
    expect(localPlatformPackage.dependencies?.['@takoserver/control-hosts']).toBeUndefined();
    expect(localPlatformPackage.dependencies?.['@hono/node-server']).toBeUndefined();
    expect(localPlatformPackage.dependencies?.['@cloudflare/containers']).toBeUndefined();
    expect(localPlatformPackage.dependencies?.['@takoserver/cloudflare-compat']).toBeUndefined();
    expect(localPlatformPackage.dependencies?.miniflare).toBeUndefined();
    await expect(access(path.join(packageRoot, 'src/web-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/dispatch-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/runtime-host-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/executor-host-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/browser-host-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/worker-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/oci-orchestrator-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/http-server.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/start-server.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/register-public-loader.mjs'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/register-loader.mjs'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/node-runtime.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(sourcePackageRoot, 'local-platform/run-entrypoint.mjs'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(sourcePackageRoot, 'local-platform/register-loader.mjs'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(sourcePackageRoot, 'local-platform/node-runtime.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(appRoot, 'src/web-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(appRoot, 'src/dispatch-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(appRoot, 'src/runtime-host-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(appRoot, 'src/executor-host-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(appRoot, 'src/browser-host-node.ts'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(appRoot, 'src/worker-node.ts'), constants.F_OK)).rejects.toBeDefined();
  });

  it('removes the public local runner shim entirely', async () => {
    await expect(access(path.join(packageRoot, 'src/node-resolve-loader.mjs'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/cloudflare-workers-shim.mjs'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/cloudflare-containers-shim.mjs'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/public-resolve-loader.mjs'), constants.F_OK)).rejects.toBeDefined();
    await expect(access(path.join(packageRoot, 'src/run-public-entrypoint.mjs'), constants.F_OK)).rejects.toBeDefined();
  });

  it('routes compose and canonical scripts through direct package imports instead of CLI/bin indirection or *-node exports', async () => {
    const controlPackage = JSON.parse(await read('package.json')) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const monorepoPackage = JSON.parse(await readFile(monorepoRootPackageJson, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const compose = await read('compose.local.yml', repoRoot);

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
      const script = controlPackage.scripts?.[scriptName];
      expect(script).toContain('pnpm exec tsx ../../packages/control/local-platform/src/');
      expect(script).not.toContain('--eval');
      expect(script).not.toContain('@takoserver/control-local-platform/');
      expect(script).not.toContain('register-public-loader');
      expect(script).not.toContain('register-loader.mjs');
      expect(script).not.toContain('run-entrypoint.mjs');
      expect(script).not.toContain('run-public-entrypoint.mjs');
    }
    expect(controlPackage.dependencies?.['@hono/node-server']).toBeUndefined();
    expect(controlPackage.dependencies?.['@cloudflare/containers']).toBeUndefined();

    expect(monorepoPackage.scripts?.['local:run-smoke']).toContain('pnpm dev:local:run-smoke');
    expect(monorepoPackage.scripts?.['local:proxyless-smoke']).toContain('pnpm dev:local:run-smoke-proxyless');

    expect(compose).toContain('["pnpm", "local:web"]');
    expect(compose).toContain('["pnpm", "local:dispatch"]');
    expect(compose).toContain('["pnpm", "local:runtime-host"]');
    expect(compose).toContain('["pnpm", "local:executor-host"]');
    expect(compose).toContain('["pnpm", "local:browser-host"]');
    expect(compose).toContain('["pnpm", "local:worker"]');
    expect(compose).toContain('["pnpm", "local:oci-orchestrator"]');
    expect(compose).not.toContain('dev:local:web:node');
    expect(compose).not.toContain('dev:local:dispatch:node');
    expect(compose).not.toContain('dev:local:runtime-host:node');
    expect(compose).not.toContain('dev:local:executor-host:node');
    expect(compose).not.toContain('dev:local:browser-host:node');
    expect(compose).not.toContain('dev:local:worker:node');
    expect(compose).not.toContain('dev:local:oci-orchestrator:node');
  });
});
