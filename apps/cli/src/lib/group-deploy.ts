/**
 * Group Deploy — local orchestrator for CLI use.
 *
 * This is a self-contained implementation that lives alongside the CLI.
 * It mirrors the logic from packages/control/src/application/services/deployment/group-deploy.ts
 * but avoids pulling in the full control package (which depends on Cloudflare Workers
 * runtime bindings not available in a Node CLI context).
 *
 * The core functions are:
 * - deployGroup(): orchestrate a full app.yml deploy
 * - provisionResources(): create D1/R2/KV/secrets
 * - generateWranglerConfig(): build wrangler config from manifest
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export type ServiceDeployStatus = 'deployed' | 'failed' | 'skipped';
export type ResourceProvisionStatus = 'provisioned' | 'exists' | 'failed';
export type BindingStatus = 'bound' | 'failed';

export interface ServiceDeployResult {
  name: string;
  type: 'worker' | 'container' | 'http';
  status: ServiceDeployStatus;
  scriptName?: string;
  url?: string;
  error?: string;
}

export interface ResourceProvisionResult {
  name: string;
  type: string;
  status: ResourceProvisionStatus;
  id?: string;
  error?: string;
}

export interface BindingResult {
  from: string;
  to: string;
  type: string;
  status: BindingStatus;
  error?: string;
}

export interface GroupDeployResult {
  groupName: string;
  env: string;
  namespace?: string;
  dryRun: boolean;
  services: ServiceDeployResult[];
  resources: ResourceProvisionResult[];
  bindings: BindingResult[];
}

export interface GroupDeployOptions {
  manifest: {
    apiVersion: string;
    kind: string;
    metadata: { name: string; appId?: string };
    spec: {
      version: string;
      resources?: Record<string, {
        type: 'd1' | 'r2' | 'kv' | 'secretRef';
        binding?: string;
      }>;
      services: Record<string, {
        type: 'worker' | 'http' | 'container';
        build?: {
          fromWorkflow: {
            path: string;
            job: string;
            artifact: string;
            artifactPath: string;
          };
        };
        baseUrl?: string;
        image?: string;
        env?: Record<string, string>;
        bindings?: {
          d1?: string[];
          r2?: string[];
          kv?: string[];
          services?: string[];
        };
      }>;
      routes?: Array<{
        name?: string;
        service: string;
        path?: string;
      }>;
    };
  };
  env: string;
  namespace?: string;
  groupName?: string;
  accountId: string;
  apiToken: string;
  dryRun?: boolean;
  compatibilityDate?: string;
  serviceFilter?: string[];
}

// ── Wrangler Direct Deploy Types ─────────────────────────────────────────────

export interface WranglerDirectDeployOptions {
  wranglerConfigPath: string;
  env: string;
  namespace?: string;
  accountId: string;
  apiToken: string;
  dryRun?: boolean;
}

export interface WranglerDirectDeployResult {
  configPath: string;
  env: string;
  namespace?: string;
  status: 'deployed' | 'failed' | 'dry-run';
  error?: string;
}

interface ProvisionedResource {
  name: string;
  type: string;
  id: string;
  binding: string;
}

interface WranglerConfig {
  name: string;
  main: string;
  compatibility_date: string;
  vars?: Record<string, string>;
  d1_databases?: Array<{ binding: string; database_name: string; database_id: string }>;
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  kv_namespaces?: Array<{ binding: string; id: string }>;
  services?: Array<{ binding: string; service: string }>;
  dispatch_namespace?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CF_API = 'https://api.cloudflare.com/client/v4';

async function cfApi<T>(
  accountId: string,
  apiToken: string,
  method: string,
  subpath: string,
  body?: unknown,
): Promise<T> {
  const url = `${CF_API}/accounts/${accountId}${subpath}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`CF API ${method} ${subpath} failed (${res.status}): ${text}`);
  }
  const data = await res.json() as { success: boolean; result: T; errors?: Array<{ message: string }> };
  if (!data.success) {
    const msg = data.errors?.map(e => e.message).join(', ') || 'Unknown error';
    throw new Error(`CF API error: ${msg}`);
  }
  return data.result;
}

function execCommand(
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = execFile(command, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        exitCode: error ? (error as { code?: number }).code || 1 : 0,
      });
    });
    if (opts?.stdin && proc.stdin) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    }
  });
}

function resourceCfName(groupName: string, env: string, resourceName: string): string {
  return `${groupName}-${env}-${resourceName}`;
}

function toBinding(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}

// ── Resource Provisioner ─────────────────────────────────────────────────────

async function provisionResources(
  resources: Record<string, { type: string; binding?: string }>,
  options: { accountId: string; apiToken: string; groupName: string; env: string; dryRun?: boolean },
): Promise<{ provisioned: Map<string, ProvisionedResource>; results: ResourceProvisionResult[] }> {
  const provisioned = new Map<string, ProvisionedResource>();
  const results: ResourceProvisionResult[] = [];

  for (const [name, resource] of Object.entries(resources)) {
    const cfName = resourceCfName(options.groupName, options.env, name);
    const binding = resource.binding || toBinding(name);

    if (options.dryRun) {
      provisioned.set(name, { name: cfName, type: resource.type, id: `(dry-run) ${cfName}`, binding });
      results.push({ name, type: resource.type, status: 'provisioned', id: `(dry-run) ${cfName}` });
      continue;
    }

    try {
      switch (resource.type) {
        case 'd1': {
          const d1 = await cfApi<{ uuid: string }>(options.accountId, options.apiToken, 'POST', '/d1/database', { name: cfName });
          provisioned.set(name, { name: cfName, type: 'd1', id: d1.uuid, binding });
          results.push({ name, type: 'd1', status: 'provisioned', id: d1.uuid });
          break;
        }
        case 'r2': {
          await cfApi<unknown>(options.accountId, options.apiToken, 'POST', '/r2/buckets', { name: cfName });
          provisioned.set(name, { name: cfName, type: 'r2', id: cfName, binding });
          results.push({ name, type: 'r2', status: 'provisioned', id: cfName });
          break;
        }
        case 'kv': {
          const kv = await cfApi<{ id: string }>(options.accountId, options.apiToken, 'POST', '/storage/kv/namespaces', { title: cfName });
          provisioned.set(name, { name: cfName, type: 'kv', id: kv.id, binding });
          results.push({ name, type: 'kv', status: 'provisioned', id: kv.id });
          break;
        }
        case 'secretRef': {
          const secretValue = randomBytes(32).toString('hex');
          provisioned.set(name, { name: cfName, type: 'secretRef', id: secretValue, binding });
          results.push({ name, type: 'secretRef', status: 'provisioned', id: '(generated)' });
          break;
        }
        default: {
          results.push({ name, type: resource.type, status: 'failed', error: `Unsupported resource type: ${resource.type}` });
        }
      }
    } catch (error) {
      results.push({ name, type: resource.type, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { provisioned, results };
}

// ── Wrangler Config Generator ────────────────────────────────────────────────

function generateWranglerConfig(
  service: GroupDeployOptions['manifest']['spec']['services'][string],
  serviceName: string,
  options: { groupName: string; env: string; namespace?: string; resources: Map<string, ProvisionedResource>; compatibilityDate?: string },
): WranglerConfig {
  if (service.type !== 'worker' || !service.build) {
    throw new Error(`Cannot generate wrangler config for non-worker service: ${serviceName}`);
  }

  const scriptName = options.namespace
    ? `${options.groupName}-${serviceName}`
    : serviceName;

  const config: WranglerConfig = {
    name: scriptName,
    main: service.build.fromWorkflow.artifactPath,
    compatibility_date: options.compatibilityDate || '2025-01-01',
  };

  if (service.env && Object.keys(service.env).length > 0) {
    config.vars = { ...service.env };
  }

  if (service.bindings?.d1 && service.bindings.d1.length > 0) {
    config.d1_databases = service.bindings.d1.map((resourceName) => {
      const p = options.resources.get(resourceName);
      return {
        binding: p?.binding || toBinding(resourceName),
        database_name: p?.name || resourceName,
        database_id: p?.id || 'TODO',
      };
    });
  }

  if (service.bindings?.r2 && service.bindings.r2.length > 0) {
    config.r2_buckets = service.bindings.r2.map((resourceName) => {
      const p = options.resources.get(resourceName);
      return {
        binding: p?.binding || toBinding(resourceName),
        bucket_name: p?.name || resourceName,
      };
    });
  }

  if (service.bindings?.kv && service.bindings.kv.length > 0) {
    config.kv_namespaces = service.bindings.kv.map((resourceName) => {
      const p = options.resources.get(resourceName);
      return {
        binding: p?.binding || toBinding(resourceName),
        id: p?.id || 'TODO',
      };
    });
  }

  if (service.bindings?.services && service.bindings.services.length > 0) {
    config.services = service.bindings.services.map((target) => {
      const targetScript = options.namespace
        ? `${options.groupName}-${target}`
        : target;
      return { binding: toBinding(target), service: targetScript };
    });
  }

  if (options.namespace) {
    config.dispatch_namespace = options.namespace;
  }

  return config;
}

function serializeWranglerToml(config: WranglerConfig): string {
  const lines: string[] = [];

  lines.push(`name = ${JSON.stringify(config.name)}`);
  lines.push(`main = ${JSON.stringify(config.main)}`);
  lines.push(`compatibility_date = ${JSON.stringify(config.compatibility_date)}`);

  if (config.dispatch_namespace) {
    lines.push(`dispatch_namespace = ${JSON.stringify(config.dispatch_namespace)}`);
  }

  if (config.vars && Object.keys(config.vars).length > 0) {
    lines.push('');
    lines.push('[vars]');
    for (const [key, value] of Object.entries(config.vars)) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }

  if (config.d1_databases) {
    for (const db of config.d1_databases) {
      lines.push('');
      lines.push('[[d1_databases]]');
      lines.push(`binding = ${JSON.stringify(db.binding)}`);
      lines.push(`database_name = ${JSON.stringify(db.database_name)}`);
      lines.push(`database_id = ${JSON.stringify(db.database_id)}`);
    }
  }

  if (config.r2_buckets) {
    for (const bucket of config.r2_buckets) {
      lines.push('');
      lines.push('[[r2_buckets]]');
      lines.push(`binding = ${JSON.stringify(bucket.binding)}`);
      lines.push(`bucket_name = ${JSON.stringify(bucket.bucket_name)}`);
    }
  }

  if (config.kv_namespaces) {
    for (const kv of config.kv_namespaces) {
      lines.push('');
      lines.push('[[kv_namespaces]]');
      lines.push(`binding = ${JSON.stringify(kv.binding)}`);
      lines.push(`id = ${JSON.stringify(kv.id)}`);
    }
  }

  if (config.services) {
    for (const svc of config.services) {
      lines.push('');
      lines.push('[[services]]');
      lines.push(`binding = ${JSON.stringify(svc.binding)}`);
      lines.push(`service = ${JSON.stringify(svc.service)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── Worker Deploy via Wrangler ───────────────────────────────────────────────

async function deployWorkerWithWrangler(
  tomlContent: string,
  options: {
    accountId: string;
    apiToken: string;
    secrets?: Map<string, string>;
    scriptName: string;
  },
): Promise<{ success: boolean; error?: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-group-deploy-'));
  const tomlPath = path.join(tmpDir, 'wrangler.toml');
  const entryPath = path.join(tmpDir, 'index.js');

  try {
    await fs.writeFile(tomlPath, tomlContent, 'utf8');
    // Minimal entry point — in production the artifact would be fetched from CI
    await fs.writeFile(entryPath, 'export default { fetch() { return new Response("ok"); } };', 'utf8');

    const wranglerEnv: NodeJS.ProcessEnv = {
      CLOUDFLARE_ACCOUNT_ID: options.accountId,
      CLOUDFLARE_API_TOKEN: options.apiToken,
    };

    // Deploy
    const deployResult = await execCommand(
      'npx',
      ['wrangler', 'deploy', '--config', tomlPath],
      { cwd: tmpDir, env: wranglerEnv },
    );

    if (deployResult.exitCode !== 0) {
      return { success: false, error: `wrangler deploy failed: ${deployResult.stderr || deployResult.stdout}` };
    }

    // Set secrets
    if (options.secrets && options.secrets.size > 0) {
      for (const [secretName, secretValue] of options.secrets) {
        const secretResult = await execCommand(
          'npx',
          ['wrangler', 'secret', 'put', secretName, '--name', options.scriptName],
          { cwd: tmpDir, env: wranglerEnv, stdin: secretValue },
        );
        if (secretResult.exitCode !== 0) {
          return { success: false, error: `Failed to set secret ${secretName}: ${secretResult.stderr || secretResult.stdout}` };
        }
      }
    }

    return { success: true };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Binding result collector ─────────────────────────────────────────────────

function collectBindingResults(
  serviceName: string,
  service: GroupDeployOptions['manifest']['spec']['services'][string],
  status: 'bound' | 'failed',
): BindingResult[] {
  const results: BindingResult[] = [];
  if (service.bindings?.d1) {
    for (const r of service.bindings.d1) results.push({ from: serviceName, to: r, type: 'd1', status });
  }
  if (service.bindings?.r2) {
    for (const r of service.bindings.r2) results.push({ from: serviceName, to: r, type: 'r2', status });
  }
  if (service.bindings?.kv) {
    for (const r of service.bindings.kv) results.push({ from: serviceName, to: r, type: 'kv', status });
  }
  if (service.bindings?.services) {
    for (const r of service.bindings.services) results.push({ from: serviceName, to: r, type: 'service', status });
  }
  return results;
}

// ── Main orchestrator ────────────────────────────────────────────────────────

export async function deployGroup(options: GroupDeployOptions): Promise<GroupDeployResult> {
  const {
    manifest,
    env,
    namespace,
    accountId,
    apiToken,
    dryRun = false,
    compatibilityDate,
    serviceFilter,
  } = options;

  const groupName = options.groupName || manifest.metadata.name;

  const result: GroupDeployResult = {
    groupName,
    env,
    namespace,
    dryRun,
    services: [],
    resources: [],
    bindings: [],
  };

  // ── Step 1: Provision resources ──────────────────────────────────────────
  // When serviceFilter is set, only provision resources referenced by filtered services

  let resourcesToProvision = manifest.spec.resources || {};
  if (serviceFilter && serviceFilter.length > 0) {
    const referencedResources = new Set<string>();
    for (const svcName of serviceFilter) {
      const svc = manifest.spec.services[svcName];
      if (svc?.bindings) {
        for (const r of svc.bindings.d1 || []) referencedResources.add(r);
        for (const r of svc.bindings.r2 || []) referencedResources.add(r);
        for (const r of svc.bindings.kv || []) referencedResources.add(r);
      }
    }
    const allResources = manifest.spec.resources || {};
    resourcesToProvision = Object.fromEntries(
      Object.entries(allResources).filter(([name]) => referencedResources.has(name)),
    );
  }

  const { provisioned, results: resourceResults } = await provisionResources(
    resourcesToProvision,
    { accountId, apiToken, groupName, env, dryRun },
  );
  result.resources = resourceResults;

  // ── Step 2: Deploy each service ──────────────────────────────────────────

  for (const [serviceName, service] of Object.entries(manifest.spec.services)) {
    // Skip services not in the filter
    if (serviceFilter && serviceFilter.length > 0 && !serviceFilter.includes(serviceName)) {
      continue;
    }
    if (service.type === 'http') {
      result.services.push({ name: serviceName, type: 'http', status: 'skipped', url: service.baseUrl });
      continue;
    }

    if (service.type === 'container') {
      result.services.push({
        name: serviceName,
        type: 'container',
        status: 'skipped',
        error: 'Container deployment not yet implemented in group deploy',
      });
      continue;
    }

    // Worker service
    const wranglerConfig = generateWranglerConfig(service, serviceName, {
      groupName,
      env,
      namespace,
      resources: provisioned,
      compatibilityDate,
    });

    if (dryRun) {
      result.services.push({ name: serviceName, type: 'worker', status: 'deployed', scriptName: wranglerConfig.name });
      result.bindings.push(...collectBindingResults(serviceName, service, 'bound'));
      continue;
    }

    // Collect secrets for this service
    const serviceSecrets = new Map<string, string>();
    for (const [, resource] of provisioned) {
      if (resource.type === 'secretRef') {
        serviceSecrets.set(resource.binding, resource.id);
      }
    }

    const toml = serializeWranglerToml(wranglerConfig);

    try {
      const deployResult = await deployWorkerWithWrangler(toml, {
        accountId,
        apiToken,
        secrets: serviceSecrets.size > 0 ? serviceSecrets : undefined,
        scriptName: wranglerConfig.name,
      });

      if (deployResult.success) {
        result.services.push({ name: serviceName, type: 'worker', status: 'deployed', scriptName: wranglerConfig.name });
        result.bindings.push(...collectBindingResults(serviceName, service, 'bound'));
      } else {
        result.services.push({ name: serviceName, type: 'worker', status: 'failed', scriptName: wranglerConfig.name, error: deployResult.error });
        result.bindings.push(...collectBindingResults(serviceName, service, 'failed'));
      }
    } catch (error) {
      result.services.push({
        name: serviceName,
        type: 'worker',
        status: 'failed',
        scriptName: wranglerConfig.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

// ── Wrangler Direct Deploy ───────────────────────────────────────────────────

function injectDispatchNamespace(tomlContent: string, env: string, namespace: string): string {
  const dispatchLine = `dispatch_namespace = ${JSON.stringify(namespace)}`;

  // Remove existing dispatch_namespace in the target env section or top-level
  const lines = tomlContent.split('\n');
  const filtered = lines.filter(line => !line.trim().startsWith('dispatch_namespace'));
  let content = filtered.join('\n');

  // Find [env.<env>] section
  const envSectionRegex = new RegExp(`^\\[env\\.${env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm');
  const match = envSectionRegex.exec(content);

  if (match) {
    // Insert after the section header line
    const insertPos = match.index + match[0].length;
    content = content.slice(0, insertPos) + '\n' + dispatchLine + content.slice(insertPos);
  } else {
    // No env section found — add at top level
    content = content.trimEnd() + '\n' + dispatchLine + '\n';
  }

  return content;
}

export async function deployWranglerDirect(
  options: WranglerDirectDeployOptions,
): Promise<WranglerDirectDeployResult> {
  const { wranglerConfigPath, env, namespace, accountId, apiToken, dryRun } = options;

  let tomlContent: string;
  try {
    tomlContent = await fs.readFile(wranglerConfigPath, 'utf8');
  } catch (error) {
    return {
      configPath: wranglerConfigPath,
      env,
      namespace,
      status: 'failed',
      error: `Failed to read config: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Inject dispatch_namespace if --namespace is specified
  if (namespace) {
    tomlContent = injectDispatchNamespace(tomlContent, env, namespace);
  }

  if (dryRun) {
    console.log(tomlContent);
    return {
      configPath: wranglerConfigPath,
      env,
      namespace,
      status: 'dry-run',
    };
  }

  // Write to temp file and deploy
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-wrangler-direct-'));
  const tmpConfigPath = path.join(tmpDir, 'wrangler.toml');

  try {
    await fs.writeFile(tmpConfigPath, tomlContent, 'utf8');

    const wranglerEnv: NodeJS.ProcessEnv = {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: apiToken,
    };

    const deployResult = await execCommand(
      'npx',
      ['wrangler', 'deploy', '--config', tmpConfigPath, '--env', env],
      { cwd: tmpDir, env: wranglerEnv },
    );

    if (deployResult.exitCode !== 0) {
      return {
        configPath: wranglerConfigPath,
        env,
        namespace,
        status: 'failed',
        error: `wrangler deploy failed: ${deployResult.stderr || deployResult.stdout}`,
      };
    }

    return {
      configPath: wranglerConfigPath,
      env,
      namespace,
      status: 'deployed',
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
