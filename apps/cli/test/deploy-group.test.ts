import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  loadAppManifest: vi.fn(),
  resolveAppManifestPath: vi.fn(),
  deployGroup: vi.fn(),
  deployWranglerDirect: vi.fn(),
  cliExit: vi.fn((code?: number) => {
    throw new Error(`cliExit:${code ?? 0}`);
  }),
}));

vi.mock('../src/lib/app-manifest.js', () => ({
  loadAppManifest: mocks.loadAppManifest,
  resolveAppManifestPath: mocks.resolveAppManifestPath,
}));

vi.mock('../src/lib/group-deploy.js', () => ({
  deployGroup: mocks.deployGroup,
  deployWranglerDirect: mocks.deployWranglerDirect,
}));

vi.mock('../src/lib/command-exit.js', () => ({
  cliExit: mocks.cliExit,
}));

import { registerDeployGroupCommand } from '../src/commands/deploy-group.js';

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerDeployGroupCommand(program);
  return program;
}

const sampleManifest = {
  apiVersion: 'takos.dev/v1alpha1',
  kind: 'App',
  metadata: { name: 'test-app' },
  spec: {
    version: '1.0.0',
    services: {
      api: {
        type: 'worker',
        build: {
          fromWorkflow: {
            path: '.takos/workflows/build.yml',
            job: 'build',
            artifact: 'api-worker',
            artifactPath: 'dist/index.js',
          },
        },
        bindings: {
          d1: ['main-db'],
        },
      },
      'browser-host': {
        type: 'worker',
        build: {
          fromWorkflow: {
            path: '.takos/workflows/build.yml',
            job: 'build',
            artifact: 'browser-host-worker',
            artifactPath: 'dist/browser.js',
          },
        },
        bindings: {
          r2: ['assets'],
        },
      },
    },
    resources: {
      'main-db': {
        type: 'd1',
        binding: 'DB',
      },
      assets: {
        type: 'r2',
        binding: 'ASSETS',
      },
    },
  },
};

describe('deploy-group command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAppManifestPath.mockResolvedValue('/repo/.takos/app.yml');
    mocks.loadAppManifest.mockResolvedValue(sampleManifest);
    mocks.deployGroup.mockResolvedValue({
      groupName: 'test-app',
      env: 'staging',
      dryRun: true,
      services: [
        { name: 'api', type: 'worker', status: 'deployed', scriptName: 'test-app-api' },
        { name: 'browser-host', type: 'worker', status: 'deployed', scriptName: 'test-app-browser-host' },
      ],
      resources: [
        { name: 'main-db', type: 'd1', status: 'provisioned', id: '(dry-run) test-app-staging-main-db' },
        { name: 'assets', type: 'r2', status: 'provisioned', id: '(dry-run) test-app-staging-assets' },
      ],
      bindings: [
        { from: 'api', to: 'main-db', type: 'd1', status: 'bound' },
        { from: 'browser-host', to: 'assets', type: 'r2', status: 'bound' },
      ],
    });
    mocks.deployWranglerDirect.mockResolvedValue({
      configPath: '/tmp/wrangler.toml',
      env: 'staging',
      status: 'deployed',
    });
  });

  it('requires --env', async () => {
    const program = createProgram();

    await expect(program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
    ], { from: 'node' })).rejects.toThrow(/required option '--env <env>' not specified/);
  });

  it('requires account ID', async () => {
    const program = createProgram();
    // Clear env to force error
    const origAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const origCfAccountId = process.env.CF_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CF_ACCOUNT_ID;

    try {
      await expect(program.parseAsync([
        'node',
        'takos',
        'deploy-group',
        '--env',
        'staging',
        '--api-token',
        'token-1',
      ], { from: 'node' })).rejects.toThrow(/cliExit:1/);
    } finally {
      if (origAccountId !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = origAccountId;
      if (origCfAccountId !== undefined) process.env.CF_ACCOUNT_ID = origCfAccountId;
    }
  });

  it('calls deployGroup with correct options for dry-run', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--dry-run',
      '--namespace',
      'takos-staging',
    ], { from: 'node' });

    expect(mocks.deployGroup).toHaveBeenCalledWith(expect.objectContaining({
      env: 'staging',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
      namespace: 'takos-staging',
    }));

    logSpy.mockRestore();
  });

  it('outputs JSON when --json is passed', async () => {
    const program = createProgram();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--dry-run',
      '--json',
    ], { from: 'node' });

    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map(c => String(c[0])).join('');
    const parsed = JSON.parse(output);
    expect(parsed.groupName).toBe('test-app');
    expect(parsed.services).toHaveLength(2);
    expect(parsed.resources).toHaveLength(2);

    stdoutSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('passes --service as serviceFilter to deployGroup', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--dry-run',
      '--service',
      'browser-host',
    ], { from: 'node' });

    expect(mocks.deployGroup).toHaveBeenCalledWith(expect.objectContaining({
      serviceFilter: ['browser-host'],
    }));

    logSpy.mockRestore();
  });

  it('errors when --service specifies a non-existent service', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--service',
      'nonexistent',
    ], { from: 'node' })).rejects.toThrow(/cliExit:1/);

    logSpy.mockRestore();
  });

  it('supports multiple --service values', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--dry-run',
      '--service',
      'api',
      'browser-host',
    ], { from: 'node' });

    expect(mocks.deployGroup).toHaveBeenCalledWith(expect.objectContaining({
      serviceFilter: ['api', 'browser-host'],
    }));

    logSpy.mockRestore();
  });

  it('calls deployWranglerDirect when --wrangler-config is used', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--wrangler-config',
      '/tmp/wrangler.toml',
    ], { from: 'node' });

    expect(mocks.deployWranglerDirect).toHaveBeenCalledWith(expect.objectContaining({
      wranglerConfigPath: '/tmp/wrangler.toml',
      env: 'staging',
      accountId: 'acct-1',
      apiToken: 'token-1',
    }));
    expect(mocks.deployGroup).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('errors when --wrangler-config is used with --manifest', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--wrangler-config',
      '/tmp/wrangler.toml',
      '--manifest',
      '/some/app.yml',
    ], { from: 'node' })).rejects.toThrow(/cliExit:1/);

    logSpy.mockRestore();
  });

  it('errors when --wrangler-config is used with --service', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--wrangler-config',
      '/tmp/wrangler.toml',
      '--service',
      'api',
    ], { from: 'node' })).rejects.toThrow(/cliExit:1/);

    logSpy.mockRestore();
  });

  it('passes namespace to deployWranglerDirect when --wrangler-config and --namespace', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--wrangler-config',
      '/tmp/wrangler.toml',
      '--namespace',
      'takos-staging',
    ], { from: 'node' });

    expect(mocks.deployWranglerDirect).toHaveBeenCalledWith(expect.objectContaining({
      wranglerConfigPath: '/tmp/wrangler.toml',
      namespace: 'takos-staging',
    }));

    logSpy.mockRestore();
  });

  it('passes dryRun to deployWranglerDirect when --wrangler-config and --dry-run', async () => {
    mocks.deployWranglerDirect.mockResolvedValue({
      configPath: '/tmp/wrangler.toml',
      env: 'staging',
      status: 'dry-run',
    });

    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
      '--wrangler-config',
      '/tmp/wrangler.toml',
      '--dry-run',
    ], { from: 'node' });

    expect(mocks.deployWranglerDirect).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true,
    }));

    logSpy.mockRestore();
  });

  it('exits with error code when deployment has failures', async () => {
    mocks.deployGroup.mockResolvedValue({
      groupName: 'test-app',
      env: 'staging',
      dryRun: false,
      services: [
        { name: 'api', type: 'worker', status: 'failed', error: 'wrangler not found' },
      ],
      resources: [],
      bindings: [],
    });

    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(program.parseAsync([
      'node',
      'takos',
      'deploy-group',
      '--env',
      'staging',
      '--account-id',
      'acct-1',
      '--api-token',
      'token-1',
    ], { from: 'node' })).rejects.toThrow(/cliExit:1/);

    logSpy.mockRestore();
  });
});

describe('group-deploy lib', () => {
  it('generates correct wrangler TOML for a worker service', async () => {
    // Import the actual lib (not mocked) - inline to avoid mock interference
    const { deployGroup } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const result = await deployGroup({
      manifest: sampleManifest as Parameters<typeof deployGroup>[0]['manifest'],
      env: 'staging',
      namespace: 'takos-staging-tenants',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.groupName).toBe('test-app');
    expect(result.env).toBe('staging');
    expect(result.namespace).toBe('takos-staging-tenants');

    // Services
    expect(result.services).toHaveLength(2);
    const apiService = result.services.find(s => s.name === 'api');
    expect(apiService).toBeDefined();
    expect(apiService!.type).toBe('worker');
    expect(apiService!.status).toBe('deployed');
    expect(apiService!.scriptName).toBe('test-app-api');

    // Resources
    expect(result.resources).toHaveLength(2);
    const mainDb = result.resources.find(r => r.name === 'main-db');
    expect(mainDb).toBeDefined();
    expect(mainDb!.type).toBe('d1');
    expect(mainDb!.status).toBe('provisioned');

    // Bindings
    expect(result.bindings).toHaveLength(2);
    const apiBinding = result.bindings.find(b => b.from === 'api');
    expect(apiBinding).toBeDefined();
    expect(apiBinding!.to).toBe('main-db');
    expect(apiBinding!.type).toBe('d1');
    expect(result.bindings[0].status).toBe('bound');
  });

  it('skips http services', async () => {
    const { deployGroup } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const manifest = {
      ...sampleManifest,
      spec: {
        ...sampleManifest.spec,
        services: {
          ...sampleManifest.spec.services,
          external: {
            type: 'http' as const,
            baseUrl: 'https://api.external.com',
          },
        },
      },
    };

    const result = await deployGroup({
      manifest: manifest as Parameters<typeof deployGroup>[0]['manifest'],
      env: 'staging',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
    });

    const httpService = result.services.find(s => s.name === 'external');
    expect(httpService).toBeDefined();
    expect(httpService!.type).toBe('http');
    expect(httpService!.status).toBe('skipped');
    expect(httpService!.url).toBe('https://api.external.com');
  });

  it('handles secretRef resources in dry-run', async () => {
    const { deployGroup } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const manifest = {
      ...sampleManifest,
      spec: {
        ...sampleManifest.spec,
        resources: {
          ...sampleManifest.spec.resources,
          'jwt-secret': {
            type: 'secretRef' as const,
            binding: 'JWT_SECRET',
          },
        },
      },
    };

    const result = await deployGroup({
      manifest: manifest as Parameters<typeof deployGroup>[0]['manifest'],
      env: 'staging',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
    });

    const secretResource = result.resources.find(r => r.name === 'jwt-secret');
    expect(secretResource).toBeDefined();
    expect(secretResource!.type).toBe('secretRef');
    expect(secretResource!.status).toBe('provisioned');
  });

  it('uses group name override when provided', async () => {
    const { deployGroup } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const result = await deployGroup({
      manifest: sampleManifest as Parameters<typeof deployGroup>[0]['manifest'],
      env: 'production',
      groupName: 'custom-group',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
    });

    expect(result.groupName).toBe('custom-group');
  });

  it('generates script name without namespace prefix when namespace is omitted', async () => {
    const { deployGroup } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const result = await deployGroup({
      manifest: sampleManifest as Parameters<typeof deployGroup>[0]['manifest'],
      env: 'staging',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
      // no namespace
    });

    expect(result.services[0].scriptName).toBe('api');
  });

  it('filters services with serviceFilter', async () => {
    const { deployGroup } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const result = await deployGroup({
      manifest: sampleManifest as Parameters<typeof deployGroup>[0]['manifest'],
      env: 'staging',
      namespace: 'takos-staging',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
      serviceFilter: ['browser-host'],
    });

    // Only browser-host should be deployed
    expect(result.services).toHaveLength(1);
    expect(result.services[0].name).toBe('browser-host');

    // Only resources referenced by browser-host should be provisioned
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].name).toBe('assets');
    expect(result.resources[0].type).toBe('r2');
  });

  it('filters multiple services with serviceFilter', async () => {
    const { deployGroup } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const result = await deployGroup({
      manifest: sampleManifest as Parameters<typeof deployGroup>[0]['manifest'],
      env: 'staging',
      namespace: 'takos-staging',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
      serviceFilter: ['api', 'browser-host'],
    });

    expect(result.services).toHaveLength(2);
    const serviceNames = result.services.map(s => s.name).sort();
    expect(serviceNames).toEqual(['api', 'browser-host']);

    // Both resources should be provisioned
    expect(result.resources).toHaveLength(2);
  });
});

describe('container deploy', () => {
  const containerManifest = {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'App',
    metadata: { name: 'test-app' },
    spec: {
      version: '1.0.0',
      services: {
        api: {
          type: 'worker' as const,
          build: {
            fromWorkflow: {
              path: '.takos/workflows/build.yml',
              job: 'build',
              artifact: 'api-worker',
              artifactPath: 'dist/index.js',
            },
          },
        },
        browser: {
          type: 'container' as const,
          container: {
            dockerfile: 'packages/browser-service/Dockerfile',
            port: 8080,
            instanceType: 'standard-2',
            maxInstances: 25,
          },
        },
      },
    },
  };

  it('deploys container service in dry-run (not skipped)', async () => {
    const { deployGroup } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const result = await deployGroup({
      manifest: containerManifest as Parameters<typeof deployGroup>[0]['manifest'],
      env: 'staging',
      namespace: 'takos-staging',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
    });

    const containerService = result.services.find(s => s.name === 'browser');
    expect(containerService).toBeDefined();
    expect(containerService!.type).toBe('container');
    expect(containerService!.status).toBe('deployed');
    expect(containerService!.scriptName).toBe('test-app-browser');
    expect(containerService!.error).toContain('[dry-run]');
    expect(containerService!.error).toContain('Dockerfile: packages/browser-service/Dockerfile');
    expect(containerService!.error).toContain('Port: 8080');
    expect(containerService!.error).toContain('Instance Type: standard-2');
    expect(containerService!.error).toContain('Max Instances: 25');
  });

  it('generates correct container wrangler config', async () => {
    const { generateContainerWranglerConfig } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const config = generateContainerWranglerConfig(
      'browser',
      containerManifest.spec.services.browser,
      {
        manifest: containerManifest,
        env: 'staging',
        namespace: 'takos-staging',
        accountId: 'acct-1',
        apiToken: 'token-1',
      } as Parameters<typeof generateContainerWranglerConfig>[2],
    );

    expect(config.name).toBe('test-app-browser');
    expect(config.main).toBe('index.js');
    expect(config.compatibility_flags).toEqual(['nodejs_compat']);
    expect(config.durable_objects.bindings).toEqual([{
      name: 'BROWSER_CONTAINER',
      class_name: 'BrowserContainer',
    }]);
    expect(config.containers).toEqual([{
      class_name: 'BrowserContainer',
      image: 'packages/browser-service/Dockerfile',
      image_build_context: '.',
      instance_type: 'standard-2',
      max_instances: 25,
    }]);
    expect(config.migrations).toEqual([{
      tag: 'v1',
      new_classes: ['BrowserContainer'],
    }]);
    expect(config.dispatch_namespace).toBe('takos-staging');
  });

  it('generates correct container wrangler config without namespace', async () => {
    const { generateContainerWranglerConfig } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const config = generateContainerWranglerConfig(
      'browser',
      containerManifest.spec.services.browser,
      {
        manifest: containerManifest,
        env: 'staging',
        accountId: 'acct-1',
        apiToken: 'token-1',
      } as Parameters<typeof generateContainerWranglerConfig>[2],
    );

    expect(config.name).toBe('browser');
    expect(config.dispatch_namespace).toBeUndefined();
  });

  it('generates correct container host entry', async () => {
    const { generateContainerHostEntry } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const entry = generateContainerHostEntry('browser', containerManifest.spec.services.browser);

    expect(entry).toContain("import { Container } from '@cloudflare/containers'");
    expect(entry).toContain('export class BrowserContainer extends Container');
    expect(entry).toContain('defaultPort = 8080');
    expect(entry).toContain("sleepAfter = '5 minutes'");
    expect(entry).toContain('env.BROWSER_CONTAINER.idFromName');
    expect(entry).toContain('env.BROWSER_CONTAINER.get(id)');
  });

  it('generates correct host entry for hyphenated service name', async () => {
    const { generateContainerHostEntry } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const service = {
      type: 'container' as const,
      container: {
        dockerfile: 'Dockerfile',
        port: 3000,
      },
    };

    const entry = generateContainerHostEntry('my-cool-service', service);

    expect(entry).toContain('export class MyCoolServiceContainer extends Container');
    expect(entry).toContain('defaultPort = 3000');
    expect(entry).toContain('env.MY_COOL_SERVICE_CONTAINER.idFromName');
  });

  it('serializes container wrangler TOML correctly', async () => {
    const { serializeContainerWranglerToml } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const toml = serializeContainerWranglerToml({
      name: 'test-app-browser',
      main: 'index.js',
      compatibility_date: '2025-01-01',
      compatibility_flags: ['nodejs_compat'],
      durable_objects: {
        bindings: [{ name: 'BROWSER_CONTAINER', class_name: 'BrowserContainer' }],
      },
      containers: [{
        class_name: 'BrowserContainer',
        image: './Dockerfile',
        image_build_context: '.',
        instance_type: 'standard-2',
        max_instances: 25,
      }],
      migrations: [{
        tag: 'v1',
        new_classes: ['BrowserContainer'],
      }],
      dispatch_namespace: 'takos-staging',
    });

    expect(toml).toContain('name = "test-app-browser"');
    expect(toml).toContain('main = "index.js"');
    expect(toml).toContain('compatibility_date = "2025-01-01"');
    expect(toml).toContain('compatibility_flags = ["nodejs_compat"]');
    expect(toml).toContain('dispatch_namespace = "takos-staging"');
    expect(toml).toContain('[[durable_objects.bindings]]');
    expect(toml).toContain('name = "BROWSER_CONTAINER"');
    expect(toml).toContain('class_name = "BrowserContainer"');
    expect(toml).toContain('[[containers]]');
    expect(toml).toContain('image = "./Dockerfile"');
    expect(toml).toContain('image_build_context = "."');
    expect(toml).toContain('instance_type = "standard-2"');
    expect(toml).toContain('max_instances = 25');
    expect(toml).toContain('[[migrations]]');
    expect(toml).toContain('tag = "v1"');
    expect(toml).toContain('new_classes = ["BrowserContainer"]');
  });

  it('uses default values for optional container fields', async () => {
    const { generateContainerWranglerConfig } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const minimalService = {
      type: 'container' as const,
      container: {
        dockerfile: 'Dockerfile',
      },
    };

    const config = generateContainerWranglerConfig(
      'worker-box',
      minimalService,
      {
        manifest: { ...containerManifest, metadata: { name: 'my-app' } },
        env: 'production',
        accountId: 'acct-1',
        apiToken: 'token-1',
      } as Parameters<typeof generateContainerWranglerConfig>[2],
    );

    expect(config.containers[0].instance_type).toBe('basic');
    expect(config.containers[0].max_instances).toBe(10);
  });

  it('toPascalCase converts various formats correctly', async () => {
    const { toPascalCase } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    expect(toPascalCase('browser')).toBe('Browser');
    expect(toPascalCase('browser-host')).toBe('BrowserHost');
    expect(toPascalCase('my-cool-service')).toBe('MyCoolService');
    expect(toPascalCase('some_snake_case')).toBe('SomeSnakeCase');
  });

  it('dry-run container shows info but does not skip', async () => {
    const { deployGroup } = await vi.importActual<typeof import('../src/lib/group-deploy.js')>('../src/lib/group-deploy.js');

    const containerOnlyManifest = {
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'App',
      metadata: { name: 'container-app' },
      spec: {
        version: '1.0.0',
        services: {
          runner: {
            type: 'container' as const,
            container: {
              dockerfile: 'Dockerfile',
              port: 9090,
              instanceType: 'basic',
              maxInstances: 5,
            },
          },
        },
      },
    };

    const result = await deployGroup({
      manifest: containerOnlyManifest as Parameters<typeof deployGroup>[0]['manifest'],
      env: 'staging',
      accountId: 'acct-1',
      apiToken: 'token-1',
      dryRun: true,
    });

    expect(result.services).toHaveLength(1);
    const svc = result.services[0];
    expect(svc.name).toBe('runner');
    expect(svc.type).toBe('container');
    expect(svc.status).not.toBe('skipped');
    expect(svc.status).toBe('deployed');
    expect(svc.scriptName).toBe('runner');
  });
});
