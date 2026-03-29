import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

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

describe('platform architecture contract', () => {
  it('keeps the shared platform builder free of named runtime binding extraction', () => {
    const sharedBuilder = read('src/platform/adapters/shared.ts');

    expect(sharedBuilder).not.toContain("'DB'");
    expect(sharedBuilder).not.toContain("'RUN_QUEUE'");
    expect(sharedBuilder).not.toContain("'INDEX_QUEUE'");
    expect(sharedBuilder).not.toContain("'WORKFLOW_QUEUE'");
    expect(sharedBuilder).not.toContain("'DEPLOY_QUEUE'");
    expect(sharedBuilder).not.toContain("'SESSION_DO'");
    expect(sharedBuilder).not.toContain("'RUN_NOTIFIER'");
    expect(sharedBuilder).not.toContain("'TAKOS_OFFLOAD'");
    expect(sharedBuilder).not.toContain("'DISPATCHER'");
  });

  it('keeps Cloudflare-specific PDF rendering out of thread export application logic', () => {
    const threadExport = read('src/application/services/threads/thread-export.ts');
    const cloudflarePdfProvider = read('src/platform/providers/cloudflare/pdf-render.ts');

    expect(threadExport).not.toContain('@cloudflare/puppeteer');
    expect(cloudflarePdfProvider).toContain('@cloudflare/puppeteer');
  });

  it('keeps route and middleware layers off getPlatformBindings() and session Env bags', () => {
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
      expect(source).not.toContain('getPlatformBindings(');
      expect(source).not.toContain('createSession(c.env');
      expect(source).not.toContain('deleteSession(c.env');
      expect(source).not.toContain('getSession(c.env');
      expect(source).not.toContain('getSession(env,');
      expect(source).not.toContain('createSession(platformBindings');
      expect(source).not.toContain('getSession(platformBindings');
    }
  });

  it('keeps canonical package source off getPlatformBindings()', () => {
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

    expect(offenders).toEqual([]);
  });

  it('keeps deployment core off worker-centric deployment pointer field names', () => {
    const deploymentCoreFiles = [
      'src/application/services/deployment/service.ts',
    ];

    for (const relativePath of deploymentCoreFiles) {
      const source = read(relativePath);
      expect(source).not.toContain('currentDeploymentId');
      expect(source).not.toContain('previousDeploymentId');
      expect(source).not.toContain('workers.currentDeploymentId');
      expect(source).not.toContain('workers.previousDeploymentId');
    }
  });

  it('keeps application, tool, and server layers off direct Cloudflare provider implementations', () => {
    const scopedFiles = [
      ...listTsFiles('src/application/services'),
      ...listTsFiles('src/application/tools'),
      ...listTsFiles('src/server'),
    ];

    for (const relativePath of scopedFiles) {
      const source = read(relativePath);
      expect(source).not.toMatch(/from ['"].*application\/services\/cloudflare\//);
      expect(source).not.toMatch(/from ['"].*application\/services\/wfp(?:\/|['"])/);
      expect(source).not.toMatch(/from ['"].*services\/cloudflare\//);
      expect(source).not.toMatch(/from ['"].*services\/wfp(?:\/|['"])/);
    }
  });

  it('keeps canonical core and local public path off @cloudflare/containers', () => {
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

    expect(offenders).toEqual([]);
  });

  it('keeps worker-centric deployment schema fields fenced to mapping layers', () => {
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

    expect(offenders).toEqual([]);
  });

  it('keeps worker facade, platform tools, and resource binding routes on service-centric table aliases', () => {
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
      expect(source).not.toContain('from(workers)');
      expect(source).not.toContain('insert(workers)');
      expect(source).not.toContain('delete(workers)');
      expect(source).not.toContain('eq(workers.');
      expect(source).not.toMatch(/import\s*\{[^}]*\bworkers\b[^}]*\}\s*from ['"].*infra\/db\/schema/);
    }
  });

  it('keeps canonical deployment logic off worker-centric schema pointer names', () => {
    const scopedFiles = [
      'src/application/services/deployment/service.ts',
      'src/application/services/deployment/routing.ts',
      'src/application/services/deployment/provider.ts',
    ];

    for (const relativePath of scopedFiles) {
      const source = read(relativePath);
      expect(source).not.toContain('currentDeploymentId');
      expect(source).not.toContain('previousDeploymentId');
      expect(source).not.toContain('workers.currentDeploymentId');
      expect(source).not.toContain('workers.previousDeploymentId');
    }
  });

  it('keeps canonical deployment logic off worker-centric deployment helper names', () => {
    const scopedFiles = [
      'src/application/services/deployment/service.ts',
      'src/application/services/deployment/routing.ts',
    ];

    for (const relativePath of scopedFiles) {
      const source = read(relativePath);
      expect(source).not.toContain('getWorkerBasics');
      expect(source).not.toContain('getWorkerRollbackInfo');
      expect(source).not.toContain('findDeploymentByWorkerVersion');
      expect(source).not.toContain('getDeploymentRoutingWorkerRecord');
      expect(source).not.toContain('updateWorkerDeploymentPointers');
      expect(source).not.toContain('fetchWorkerWithDomains');
      expect(source).not.toContain('WorkerBasics');
      expect(source).not.toContain('WorkerRollbackInfo');
      expect(source).not.toContain('DeploymentRoutingWorkerRecord');
    }
  });

  it('keeps baseline SQL service storage pointed at services/route deployment fields', () => {
    const baselineSql = readApp('db/migrations/0001_baseline.sql');

    expect(baselineSql).toContain('CREATE TABLE "services"');
    expect(baselineSql).toContain('"route_ref"');
    expect(baselineSql).toContain('"active_deployment_id"');
    expect(baselineSql).toContain('"fallback_deployment_id"');
    expect(baselineSql).toContain('CREATE TABLE "service_bindings"');
    expect(baselineSql).toContain('CREATE TABLE "service_common_env_links"');
    expect(baselineSql).toContain('CREATE TABLE "service_env_vars"');
    expect(baselineSql).toContain('CREATE TABLE "service_runtime_settings"');
    expect(baselineSql).not.toContain('"current_deployment_id"');
    expect(baselineSql).not.toContain('"previous_deployment_id"');
  });

  it('keeps local runtime scripts pointed at canonical package entrypoints without public node-wrapper exports', () => {
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

    expect(controlPackage.scripts?.['dev:local:web']).toBe('pnpm exec tsx ../../packages/control/local-platform/src/web.ts');
    expect(controlPackage.scripts?.['dev:local:dispatch']).toBe('pnpm exec tsx ../../packages/control/local-platform/src/dispatch.ts');
    expect(controlPackage.scripts?.['dev:local:runtime-host']).toBe('pnpm exec tsx ../../packages/control/local-platform/src/runtime-host.ts');
    expect(controlPackage.scripts?.['dev:local:executor-host']).toBe('pnpm exec tsx ../../packages/control/local-platform/src/executor-host.ts');
    expect(controlPackage.scripts?.['dev:local:browser-host']).toBe('pnpm exec tsx ../../packages/control/local-platform/src/browser-host.ts');
    expect(controlPackage.scripts?.['dev:local:worker']).toBe('pnpm exec tsx ../../packages/control/local-platform/src/worker.ts');
    expect(controlPackage.scripts?.['dev:local:web']).not.toContain('register-public-loader');
    expect(controlPackage.scripts?.['dev:local:web']).not.toContain('register-loader.mjs');
    expect(controlPackage.scripts?.['dev:local:web']).not.toContain('public-resolve-loader.mjs');
    expect(controlPackage.scripts?.['dev:local:web']).not.toContain('run-public-entrypoint.mjs');
    expect(controlPackage.scripts?.['dev:local:web:node']).toBeUndefined();
    expect(controlPackage.scripts?.['dev:local:dispatch:node']).toBeUndefined();
    expect(controlPackage.scripts?.['dev:local:runtime-host:node']).toBeUndefined();
    expect(controlPackage.scripts?.['dev:local:executor-host:node']).toBeUndefined();
    expect(controlPackage.scripts?.['dev:local:browser-host:node']).toBeUndefined();
    expect(controlPackage.scripts?.['dev:local:worker:node']).toBeUndefined();
    expect(controlPackage.dependencies?.['@hono/node-server']).toBeUndefined();
    expect(localWebEntrypoint).not.toContain('fetch-server.ts');
    expect(localDispatchEntrypoint).not.toContain('fetch-server.ts');
    expect(localRuntimeHostEntrypoint).not.toContain('fetch-server.ts');
    expect(localExecutorHostEntrypoint).not.toContain('fetch-server.ts');
    expect(localBrowserHostEntrypoint).not.toContain('fetch-server.ts');

    expect(localPlatformPackage.bin).toBeUndefined();
    expect(localPlatformPackage.exports?.['./node-runtime']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./web-node']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./dispatch-node']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./runtime-host-node']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./executor-host-node']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./browser-host-node']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./worker-node']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./oci-orchestrator-node']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./run-public-entrypoint']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./register-loader']).toBeUndefined();
    expect(localPlatformPackage.exports?.['./run-entrypoint']).toBeUndefined();
    expect(localPlatformPackage.dependencies?.['takos-control-hosts']).toBeUndefined();
    expect(localPlatformPackage.dependencies?.miniflare).toBeUndefined();
  });

  it('removes the local public runner shim entirely', () => {
    expect(existsSync(path.join(appRootDir, '../../packages/control/local-platform/src/http-server.ts'))).toBe(false);
    expect(existsSync(path.join(appRootDir, '../../packages/control/local-platform/src/start-server.ts'))).toBe(false);
    expect(existsSync(path.join(appRootDir, '../../packages/control/local-platform/src/run-public-entrypoint.mjs'))).toBe(false);
    expect(existsSync(path.join(appRootDir, '../../packages/control/local-platform/src/node-runtime.ts'))).toBe(false);
    expect(
      existsSync(path.join(appRootDir, '..', '..', ['packages', 'control', 'src', 'local-platform', 'node-runtime.ts'].join('/')))
    ).toBe(false);
  });

  it('keeps local bootstrap off Node loader registration concerns', () => {
    const localBootstrap = read('src/local-platform/bootstrap.ts');

    expect(localBootstrap).not.toContain('node:module');
    expect(localBootstrap).not.toContain('registerNodeResolveLoader');
  });

  it('keeps canonical local runtime on explicit local runtime host handlers', () => {
    const localRuntime = read('src/local-platform/runtime.ts');
    // The env builder (node-platform/env-builder.ts) is the canonical location
    // for binding creation.
    const envBuilder = read('src/node-platform/env-builder.ts');
    const localTenantRuntime = read('src/local-platform/tenant-worker-runtime.ts');

    expect(localRuntime).not.toContain("takos-control-hosts/executor-host");
    expect(localRuntime).not.toContain("takos-control-hosts/runtime-host");
    expect(localRuntime).not.toContain("takos-control-hosts/browser-host");
    expect(localRuntime).not.toContain("../runtime/container-hosts/runtime-host.ts");
    expect(localRuntime).not.toContain("../runtime/container-hosts/executor-host.ts");
    expect(localRuntime).not.toContain("../runtime/container-hosts/browser-session-host.ts");

    expect(envBuilder).toContain("from '../local-platform/tenant-worker-runtime.ts'");
    expect(envBuilder).not.toContain("from '../local-platform/miniflare-registry.ts'");
    expect(localTenantRuntime).toContain("import('./miniflare-registry.ts')");
    expect(localTenantRuntime).not.toContain('TAKOS_LOCAL_DEBUG_TENANT_RUNTIME');
  });
});
