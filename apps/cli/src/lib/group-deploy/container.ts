/**
 * Group Deploy — container deploy helpers.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  ContainerWranglerConfig,
  GroupDeployOptions,
  ContainerServiceDef,
  ProvisionedResource,
  ServiceDeployResult,
} from './deploy-models.js';
import { execCommand } from './cloudflare-utils.js';
import { DEFAULT_COMPATIBILITY_DATE } from '../constants.js';

// ── Container Deploy Helpers ─────────────────────────────────────────────

export function toPascalCase(str: string): string {
  return str.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

export function generateContainerWranglerConfig(
  serviceName: string,
  service: ContainerServiceDef,
  options: GroupDeployOptions,
): ContainerWranglerConfig {
  const groupName = options.groupName || options.manifest?.metadata?.name || 'app';
  const scriptName = options.namespace
    ? `${groupName}-${serviceName}`
    : serviceName;

  if (!service.container) {
    throw new Error(`Service "${serviceName}" is missing container configuration`);
  }
  const container = service.container;
  const className = `${toPascalCase(serviceName)}Container`;

  return {
    name: scriptName,
    main: 'index.js',
    compatibility_date: options.compatibilityDate || DEFAULT_COMPATIBILITY_DATE,
    compatibility_flags: ['nodejs_compat'],
    durable_objects: {
      bindings: [{
        name: `${serviceName.toUpperCase().replace(/-/g, '_')}_CONTAINER`,
        class_name: className,
      }],
    },
    containers: [{
      class_name: className,
      image: container.dockerfile,
      image_build_context: '.',
      instance_type: container.instanceType || 'basic',
      max_instances: container.maxInstances || 10,
    }],
    migrations: [{
      tag: 'v1',
      new_classes: [className],
    }],
    ...(options.namespace ? { dispatch_namespace: options.namespace } : {}),
  };
}

export function serializeContainerWranglerToml(config: ContainerWranglerConfig): string {
  const lines: string[] = [];

  lines.push(`name = ${JSON.stringify(config.name)}`);
  lines.push(`main = ${JSON.stringify(config.main)}`);
  lines.push(`compatibility_date = ${JSON.stringify(config.compatibility_date)}`);

  if (config.compatibility_flags && config.compatibility_flags.length > 0) {
    const flags = config.compatibility_flags.map(f => JSON.stringify(f)).join(', ');
    lines.push(`compatibility_flags = [${flags}]`);
  }

  if (config.dispatch_namespace) {
    lines.push(`dispatch_namespace = ${JSON.stringify(config.dispatch_namespace)}`);
  }

  if (config.durable_objects?.bindings) {
    for (const binding of config.durable_objects.bindings) {
      lines.push('');
      lines.push('[[durable_objects.bindings]]');
      lines.push(`name = ${JSON.stringify(binding.name)}`);
      lines.push(`class_name = ${JSON.stringify(binding.class_name)}`);
    }
  }

  if (config.containers) {
    for (const container of config.containers) {
      lines.push('');
      lines.push('[[containers]]');
      lines.push(`class_name = ${JSON.stringify(container.class_name)}`);
      lines.push(`image = ${JSON.stringify(container.image)}`);
      lines.push(`image_build_context = ${JSON.stringify(container.image_build_context)}`);
      lines.push(`instance_type = ${JSON.stringify(container.instance_type)}`);
      lines.push(`max_instances = ${container.max_instances}`);
    }
  }

  if (config.migrations) {
    for (const migration of config.migrations) {
      lines.push('');
      lines.push('[[migrations]]');
      lines.push(`tag = ${JSON.stringify(migration.tag)}`);
      const classes = migration.new_classes.map(c => JSON.stringify(c)).join(', ');
      lines.push(`new_classes = [${classes}]`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function generateContainerHostEntry(serviceName: string, service: ContainerServiceDef): string {
  const className = `${toPascalCase(serviceName)}Container`;
  const bindingName = `${serviceName.toUpperCase().replace(/-/g, '_')}_CONTAINER`;
  const port = service.container?.port || 8080;

  return `import { Container } from '@cloudflare/containers';

export class ${className} extends Container {
  defaultPort = ${port};
  sleepAfter = '5 minutes';

  async onStart() {}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = env.${bindingName}.idFromName('default');
    const stub = env.${bindingName}.get(id);
    return stub.fetch(request);
  },
};
`;
}

export async function deployContainerWithWrangler(
  serviceName: string,
  service: ContainerServiceDef,
  options: GroupDeployOptions,
  _resources: Map<string, ProvisionedResource>,
): Promise<ServiceDeployResult> {
  const config = generateContainerWranglerConfig(serviceName, service, options);

  if (options.dryRun) {
    const container = service.container;
    if (!container) {
      return { name: serviceName, type: 'container', status: 'failed', error: 'Missing container configuration' };
    }
    return {
      name: serviceName,
      type: 'container',
      status: 'deployed',
      scriptName: config.name,
      error: `[dry-run] would deploy container (Dockerfile: ${container.dockerfile}, Port: ${container.port || 8080}, Instance Type: ${container.instanceType || 'basic'}, Max Instances: ${container.maxInstances || 10})`,
    };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-container-'));
  try {
    const tomlContent = serializeContainerWranglerToml(config);
    await fs.writeFile(path.join(tmpDir, 'wrangler.toml'), tomlContent, 'utf8');

    const entryContent = generateContainerHostEntry(serviceName, service);
    await fs.writeFile(path.join(tmpDir, 'index.js'), entryContent, 'utf8');

    const wranglerEnv: NodeJS.ProcessEnv = {
      CLOUDFLARE_ACCOUNT_ID: options.accountId,
      CLOUDFLARE_API_TOKEN: options.apiToken,
    };

    const tomlPath = path.join(tmpDir, 'wrangler.toml');
    const deployResult = await execCommand(
      'npx',
      ['wrangler', 'deploy', '--config', tomlPath],
      { cwd: options.manifestDir || process.cwd(), env: wranglerEnv },
    );

    if (deployResult.exitCode !== 0) {
      return {
        name: serviceName,
        type: 'container',
        status: 'failed',
        scriptName: config.name,
        error: `wrangler deploy failed: ${deployResult.stderr || deployResult.stdout}`,
      };
    }

    return {
      name: serviceName,
      type: 'container',
      status: 'deployed',
      scriptName: config.name,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* cleanup: best-effort temp dir removal */ });
  }
}
