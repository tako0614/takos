import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

const appRootDir = path.resolve(import.meta.dirname, '../..');
const sourceRootDir = path.resolve(appRootDir, '../../packages/control');

function read(relativePath: string): string {
  return readFileSync(path.join(sourceRootDir, relativePath), 'utf8');
}

function readApp(relativePath: string): string {
  return readFileSync(path.join(appRootDir, relativePath), 'utf8');
}

function listTsFiles(relativeDir: string): string[] {
  const absDir = path.join(sourceRootDir, relativeDir);
  const entries = readdirSync(absDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (relativePath === 'src/application/services/cloudflare' || relativePath === 'src/application/services/wfp') {
        continue;
      }
      files.push(...listTsFiles(relativePath));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}


  Deno.test('platform architecture contract - keeps the shared platform builder free of named runtime binding extraction', () => {
  const sharedBuilder = read('src/platform/adapters/shared.ts');

    assert(!(sharedBuilder).includes("'DB'"));
    assert(!(sharedBuilder).includes("'RUN_QUEUE'"));
    assert(!(sharedBuilder).includes("'INDEX_QUEUE'"));
    assert(!(sharedBuilder).includes("'WORKFLOW_QUEUE'"));
    assert(!(sharedBuilder).includes("'DEPLOY_QUEUE'"));
    assert(!(sharedBuilder).includes("'SESSION_DO'"));
    assert(!(sharedBuilder).includes("'RUN_NOTIFIER'"));
    assert(!(sharedBuilder).includes("'TAKOS_OFFLOAD'"));
    assert(!(sharedBuilder).includes("'DISPATCHER'"));
})
  Deno.test('platform architecture contract - keeps Cloudflare-specific PDF rendering out of thread export application logic', () => {
  const threadExport = read('src/application/services/threads/thread-export.ts');
    const cloudflarePdfProvider = read('src/platform/providers/cloudflare/pdf-render.ts');

    assert(!(threadExport).includes('@cloudflare/puppeteer'));
    assertStringIncludes(cloudflarePdfProvider, '@cloudflare/puppeteer');
})
  Deno.test('platform architecture contract - keeps route and middleware layers off getPlatformBindings() and session Env bags', () => {
  const routeAndMiddlewareFiles = [
      'src/server/middleware/auth.ts',
      'src/server/middleware/oauth-auth.ts',
      'src/server/routes/auth/session.ts',
      'src/server/routes/auth/cli.ts',
      'src/server/routes/auth/external.ts',
      'src/server/routes/oauth/authorize.ts',
      'src/server/routes/oauth/device.ts',
      'src/server/routes/oauth-consent-api.ts',
      'src/server/routes/resources/base.ts',
      'src/server/routes/sessions/lifecycle.ts',
    ];

    for (const relativePath of routeAndMiddlewareFiles) {
      const source = read(relativePath);
      assert(!(source).includes('getPlatformBindings('));
      assert(!(source).includes('createSession(c.env'));
      assert(!(source).includes('deleteSession(c.env'));
      assert(!(source).includes('getSession(c.env'));
      assert(!(source).includes('getSession(env,'));
      assert(!(source).includes('createSession(platformBindings'));
      assert(!(source).includes('getSession(platformBindings'));
    }
})
  Deno.test('platform architecture contract - keeps canonical package source off getPlatformBindings()', () => {
  const scopedFiles = [
      ...listTsFiles('src/application'),
      ...listTsFiles('src/server'),
      ...listTsFiles('src/runtime'),
      ...listTsFiles('src/local-platform'),
    ];

    const allowedCallers = new Set([
      'src/platform/accessors.ts',
    ]);

    const offenders = scopedFiles.filter((relativePath) => {
      if (allowedCallers.has(relativePath)) {
        return false;
      }
      return read(relativePath).includes('getPlatformBindings(');
    });

    assertEquals(offenders, []);
})
  Deno.test('platform architecture contract - keeps deployment core off worker-centric deployment pointer field names', () => {
  const deploymentCoreFiles = [
      'src/application/services/deployment/service.ts',
    ];

    for (const relativePath of deploymentCoreFiles) {
      const source = read(relativePath);
      assert(!(source).includes('currentDeploymentId'));
      assert(!(source).includes('previousDeploymentId'));
      assert(!(source).includes('workers.currentDeploymentId'));
      assert(!(source).includes('workers.previousDeploymentId'));
    }
})
  Deno.test('platform architecture contract - keeps application, tool, and server layers off direct Cloudflare provider implementations', () => {
  const scopedFiles = [
      ...listTsFiles('src/application/services'),
      ...listTsFiles('src/application/tools'),
      ...listTsFiles('src/server'),
    ];

    for (const relativePath of scopedFiles) {
      const source = read(relativePath);
      assert(!(/from ['"].*application\/services\/cloudflare\//).test(source));
      assert(!(/from ['"].*application\/services\/wfp(?:\/|['"])/).test(source));
      assert(!(/from ['"].*services\/cloudflare\//).test(source));
      assert(!(/from ['"].*services\/wfp(?:\/|['"])/).test(source));
    }
})
  Deno.test('platform architecture contract - keeps canonical core and local public path off @cloudflare/containers', () => {
  const scopedFiles = [
      ...listTsFiles('src/application'),
      ...listTsFiles('src/server'),
      ...listTsFiles('src/local-platform'),
    ].filter((relativePath) => !relativePath.endsWith('.test.ts'));

    const allowedCallers = new Set([
      'src/runtime/container-hosts/browser-session-host.ts',
      'src/runtime/container-hosts/executor-host.ts',
      'src/runtime/container-hosts/runtime-host.ts',
      'src/local-platform/bootstrap.test.ts',
    ]);

    const offenders = scopedFiles.filter((relativePath) => {
      if (allowedCallers.has(relativePath)) {
        return false;
      }
      return read(relativePath).includes('@cloudflare/containers');
    });

    assertEquals(offenders, []);
})
  Deno.test('platform architecture contract - keeps worker-centric deployment schema fields fenced to mapping layers', () => {
  const allowedSchemaFieldCallers = new Set([
      'src/application/services/deployment/store.ts',
      'src/application/services/platform/workers.ts',
    ]);

    const scopedFiles = [
      ...listTsFiles('src/application'),
      ...listTsFiles('src/server'),
    ];

    const offenders = scopedFiles.filter((relativePath) => {
      if (allowedSchemaFieldCallers.has(relativePath)) {
        return false;
      }
      const source = read(relativePath);
      return source.includes('workers.workerName')
        || source.includes('workers.currentDeploymentId')
        || source.includes('workers.previousDeploymentId');
    });

    assertEquals(offenders, []);
})
  Deno.test('platform architecture contract - keeps worker facade, platform tools, and resource binding routes on service-centric table aliases', () => {
  const scopedFiles = [
      'src/application/services/platform/workers.ts',
      'src/application/tools/builtin/platform/deployments.ts',
      'src/application/tools/builtin/platform/deployment-history.ts',
      'src/server/routes/resources/bindings.ts',
      'src/server/routes/apps.ts',
      'src/server/routes/workers/slug.ts',
      'src/application/services/platform/custom-domains.ts',
    ];

    for (const relativePath of scopedFiles) {
      const source = read(relativePath);
      assert(!(source).includes('from(workers)'));
      assert(!(source).includes('insert(workers)'));
      assert(!(source).includes('delete(workers)'));
      assert(!(source).includes('eq(workers.'));
      assert(!(/import\s*\{[^}]*\bworkers\b[^}]*\}\s*from ['"].*infra\/db\/schema/).test(source));
    }
})
  Deno.test('platform architecture contract - keeps canonical deployment logic off worker-centric schema pointer names', () => {
  const scopedFiles = [
      'src/application/services/deployment/service.ts',
      'src/application/services/deployment/routing.ts',
      'src/application/services/deployment/provider.ts',
    ];

    for (const relativePath of scopedFiles) {
      const source = read(relativePath);
      assert(!(source).includes('currentDeploymentId'));
      assert(!(source).includes('previousDeploymentId'));
      assert(!(source).includes('workers.currentDeploymentId'));
      assert(!(source).includes('workers.previousDeploymentId'));
    }
})
  Deno.test('platform architecture contract - keeps canonical deployment logic off worker-centric deployment helper names', () => {
  const scopedFiles = [
      'src/application/services/deployment/service.ts',
      'src/application/services/deployment/routing.ts',
    ];

    for (const relativePath of scopedFiles) {
      const source = read(relativePath);
      assert(!(source).includes('getWorkerBasics'));
      assert(!(source).includes('getWorkerRollbackInfo'));
      assert(!(source).includes('findDeploymentByWorkerVersion'));
      assert(!(source).includes('getDeploymentRoutingWorkerRecord'));
      assert(!(source).includes('updateWorkerDeploymentPointers'));
      assert(!(source).includes('fetchWorkerWithDomains'));
      assert(!(source).includes('WorkerBasics'));
      assert(!(source).includes('WorkerRollbackInfo'));
      assert(!(source).includes('DeploymentRoutingWorkerRecord'));
    }
})
  Deno.test('platform architecture contract - keeps baseline SQL service storage pointed at services/route deployment fields', () => {
  const baselineSql = readApp('db/migrations/0001_baseline.sql');

    assertStringIncludes(baselineSql, 'CREATE TABLE "services"');
    assertStringIncludes(baselineSql, '"route_ref"');
    assertStringIncludes(baselineSql, '"active_deployment_id"');
    assertStringIncludes(baselineSql, '"fallback_deployment_id"');
    assertStringIncludes(baselineSql, 'CREATE TABLE "service_bindings"');
    assertStringIncludes(baselineSql, 'CREATE TABLE "service_common_env_links"');
    assertStringIncludes(baselineSql, 'CREATE TABLE "service_env_vars"');
    assertStringIncludes(baselineSql, 'CREATE TABLE "service_runtime_settings"');
    assert(!(baselineSql).includes('"current_deployment_id"'));
    assert(!(baselineSql).includes('"previous_deployment_id"'));
})
  Deno.test('platform architecture contract - keeps local runtime scripts pointed at canonical package entrypoints without public node-wrapper exports', () => {
  const controlPackage = JSON.parse(readFileSync(path.join(appRootDir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const localPlatformPackage = JSON.parse(
      readFileSync(path.join(appRootDir, '../../packages/control/local-platform/package.json'), 'utf8')
    ) as {
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
      exports?: Record<string, string>;
    };
    const localWebEntrypoint = readFileSync(path.join(appRootDir, '../../packages/control/local-platform/src/web.ts'), 'utf8');
    const localDispatchEntrypoint = readFileSync(path.join(appRootDir, '../../packages/control/local-platform/src/dispatch.ts'), 'utf8');
    const localRuntimeHostEntrypoint = readFileSync(path.join(appRootDir, '../../packages/control/local-platform/src/runtime-host.ts'), 'utf8');
    const localExecutorHostEntrypoint = readFileSync(path.join(appRootDir, '../../packages/control/local-platform/src/executor-host.ts'), 'utf8');
    const localBrowserHostEntrypoint = readFileSync(path.join(appRootDir, '../../packages/control/local-platform/src/browser-host.ts'), 'utf8');

    assertEquals(controlPackage.scripts?.['dev:local:web'], 'pnpm exec tsx ../../packages/control/local-platform/src/web.ts');
    assertEquals(controlPackage.scripts?.['dev:local:dispatch'], 'pnpm exec tsx ../../packages/control/local-platform/src/dispatch.ts');
    assertEquals(controlPackage.scripts?.['dev:local:runtime-host'], 'pnpm exec tsx ../../packages/control/local-platform/src/runtime-host.ts');
    assertEquals(controlPackage.scripts?.['dev:local:executor-host'], 'pnpm exec tsx ../../packages/control/local-platform/src/executor-host.ts');
    assertEquals(controlPackage.scripts?.['dev:local:browser-host'], 'pnpm exec tsx ../../packages/control/local-platform/src/browser-host.ts');
    assertEquals(controlPackage.scripts?.['dev:local:worker'], 'pnpm exec tsx ../../packages/control/local-platform/src/worker.ts');
    assert(!(controlPackage.scripts?.['dev:local:web']).includes('register-public-loader'));
    assert(!(controlPackage.scripts?.['dev:local:web']).includes('register-loader.mjs'));
    assert(!(controlPackage.scripts?.['dev:local:web']).includes('public-resolve-loader.mjs'));
    assert(!(controlPackage.scripts?.['dev:local:web']).includes('run-public-entrypoint.mjs'));
    assertEquals(controlPackage.scripts?.['dev:local:web:node'], undefined);
    assertEquals(controlPackage.scripts?.['dev:local:dispatch:node'], undefined);
    assertEquals(controlPackage.scripts?.['dev:local:runtime-host:node'], undefined);
    assertEquals(controlPackage.scripts?.['dev:local:executor-host:node'], undefined);
    assertEquals(controlPackage.scripts?.['dev:local:browser-host:node'], undefined);
    assertEquals(controlPackage.scripts?.['dev:local:worker:node'], undefined);
    assertEquals(controlPackage.dependencies?.['@hono/node-server'], undefined);
    assert(!(localWebEntrypoint).includes('fetch-server.ts'));
    assert(!(localDispatchEntrypoint).includes('fetch-server.ts'));
    assert(!(localRuntimeHostEntrypoint).includes('fetch-server.ts'));
    assert(!(localExecutorHostEntrypoint).includes('fetch-server.ts'));
    assert(!(localBrowserHostEntrypoint).includes('fetch-server.ts'));

    assertEquals(localPlatformPackage.bin, undefined);
    assertEquals(localPlatformPackage.exports?.['./node-runtime'], undefined);
    assertEquals(localPlatformPackage.exports?.['./web-node'], undefined);
    assertEquals(localPlatformPackage.exports?.['./dispatch-node'], undefined);
    assertEquals(localPlatformPackage.exports?.['./runtime-host-node'], undefined);
    assertEquals(localPlatformPackage.exports?.['./executor-host-node'], undefined);
    assertEquals(localPlatformPackage.exports?.['./browser-host-node'], undefined);
    assertEquals(localPlatformPackage.exports?.['./worker-node'], undefined);
    assertEquals(localPlatformPackage.exports?.['./oci-orchestrator-node'], undefined);
    assertEquals(localPlatformPackage.exports?.['./run-public-entrypoint'], undefined);
    assertEquals(localPlatformPackage.exports?.['./register-loader'], undefined);
    assertEquals(localPlatformPackage.exports?.['./run-entrypoint'], undefined);
    assertEquals(localPlatformPackage.dependencies?.['takos-control-hosts'], undefined);
    assertEquals(localPlatformPackage.dependencies?.miniflare, undefined);
})
  Deno.test('platform architecture contract - removes the local public runner shim entirely', () => {
  assertEquals(existsSync(path.join(appRootDir, '../../packages/control/local-platform/src/http-server.ts')), false);
    assertEquals(existsSync(path.join(appRootDir, '../../packages/control/local-platform/src/start-server.ts')), false);
    assertEquals(existsSync(path.join(appRootDir, '../../packages/control/local-platform/src/run-public-entrypoint.mjs')), false);
    assertEquals(existsSync(path.join(appRootDir, '../../packages/control/local-platform/src/node-runtime.ts')), false);
    assertEquals(
      existsSync(path.join(appRootDir, '..', '..', ['packages', 'control', 'src', 'local-platform', 'node-runtime.ts'].join('/')))
    , false);
})
  Deno.test('platform architecture contract - keeps local bootstrap off Node loader registration concerns', () => {
  const localBootstrap = read('src/local-platform/bootstrap.ts');

    assert(!(localBootstrap).includes('node:module'));
    assert(!(localBootstrap).includes('registerNodeResolveLoader'));
})
  Deno.test('platform architecture contract - keeps canonical local runtime on explicit local runtime host handlers', () => {
  const localRuntime = read('src/local-platform/runtime.ts');
    // The env builder (node-platform/env-builder.ts) is the canonical location
    // for binding creation.
    const envBuilder = read('src/node-platform/env-builder.ts');
    const localTenantRuntime = read('src/local-platform/tenant-worker-runtime.ts');

    assert(!(localRuntime).includes("takos-control-hosts/executor-host"));
    assert(!(localRuntime).includes("takos-control-hosts/runtime-host"));
    assert(!(localRuntime).includes("takos-control-hosts/browser-host"));
    assert(!(localRuntime).includes("../runtime/container-hosts/runtime-host.ts"));
    assert(!(localRuntime).includes("../runtime/container-hosts/executor-host.ts"));
    assert(!(localRuntime).includes("../runtime/container-hosts/browser-session-host.ts"));

    assertStringIncludes(envBuilder, "from '../local-platform/tenant-worker-runtime.ts'");
    assert(!(envBuilder).includes("from '../local-platform/miniflare-registry.ts'"));
    assertStringIncludes(localTenantRuntime, "import('./miniflare-registry.ts')");
    assert(!(localTenantRuntime).includes('TAKOS_LOCAL_DEBUG_TENANT_RUNTIME'));
})