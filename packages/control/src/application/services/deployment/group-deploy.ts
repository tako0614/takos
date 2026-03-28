/**
 * Group Deploy Orchestrator.
 *
 * Deploys an entire app.yml manifest as a group — provisions resources,
 * deploys worker services via wrangler, and wires up service bindings.
 *
 * This bypasses the Takos store install flow and deploys directly to
 * Cloudflare infrastructure using the Cloudflare API and wrangler CLI.
 *
 * Usage:
 *   const result = await deployGroup({ manifest, env: 'staging', ... });
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppManifest, WorkerService } from './group-deploy-manifest.js';
import type {
  GroupDeployOptions,
  GroupDeployResult,
  ServiceDeployResult,
  BindingResult,
  ProvisionedResource,
} from './group-deploy-types.js';
import { provisionResources } from './resource-provisioner.js';
import {
  generateWranglerConfig,
  serializeWranglerToml,
} from './wrangler-config-gen.js';
import { CloudflareApiClient } from '../cloudflare/api-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function execCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        exitCode: error ? (error as NodeJS.ErrnoException & { code?: number }).code as number || 1 : 0,
      });
    });
  });
}

async function deployWorkerWithWrangler(
  tomlContent: string,
  options: {
    accountId: string;
    apiToken: string;
    namespace?: string;
    secrets?: Map<string, string>;
    dryRun?: boolean;
  },
): Promise<{ success: boolean; error?: string }> {
  // Write temporary wrangler.toml
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-group-deploy-'));
  const tomlPath = path.join(tmpDir, 'wrangler.toml');
  // Create a minimal entry point in case artifactPath is relative
  const entryPath = path.join(tmpDir, 'index.js');

  try {
    await fs.writeFile(tomlPath, tomlContent, 'utf8');
    // Placeholder entry — the real bundle comes from the artifact path in the manifest.
    // For group-deploy we expect the artifact to be available at the main path.
    await fs.writeFile(entryPath, 'export default { fetch() { return new Response("ok"); } };', 'utf8');

    if (options.dryRun) {
      return { success: true };
    }

    const wranglerEnv: NodeJS.ProcessEnv = {
      CLOUDFLARE_ACCOUNT_ID: options.accountId,
      CLOUDFLARE_API_TOKEN: options.apiToken,
    };

    // Deploy the worker
    const deployResult = await execCommand(
      'npx',
      ['wrangler', 'deploy', '--config', tomlPath],
      { cwd: tmpDir, env: wranglerEnv },
    );

    if (deployResult.exitCode !== 0) {
      return {
        success: false,
        error: `wrangler deploy failed: ${deployResult.stderr || deployResult.stdout}`,
      };
    }

    // Set secrets if any
    if (options.secrets && options.secrets.size > 0) {
      for (const [secretName, secretValue] of options.secrets) {
        const secretResult = await execCommand(
          'npx',
          ['wrangler', 'secret', 'put', secretName, '--config', tomlPath],
          {
            cwd: tmpDir,
            env: {
              ...wranglerEnv,
              // wrangler reads stdin for secret value; use echo pipe workaround
              WRANGLER_SECRET_VALUE: secretValue,
            },
          },
        );
        if (secretResult.exitCode !== 0) {
          return {
            success: false,
            error: `Failed to set secret ${secretName}: ${secretResult.stderr || secretResult.stdout}`,
          };
        }
      }
    }

    return { success: true };
  } finally {
    // Cleanup temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* cleanup: best-effort temp dir removal */ });
  }
}

// ── Dry-run plan formatter ───────────────────────────────────────────────────

function buildDryRunServiceResult(
  serviceName: string,
  service: WorkerService,
  scriptName: string,
): ServiceDeployResult {
  return {
    name: serviceName,
    type: 'worker',
    status: 'deployed',
    scriptName,
  };
}

// ── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Deploy an app manifest as a group.
 *
 * Steps:
 * 1. Provision resources (D1, R2, KV, secrets)
 * 2. Deploy each worker service via wrangler
 * 3. Wire up service bindings
 * 4. Report results
 *
 * Errors in individual services do not abort the entire deployment —
 * all services are attempted and the result reports each status.
 */
export async function deployGroup(options: GroupDeployOptions): Promise<GroupDeployResult> {
  const {
    manifest,
    env,
    namespace,
    accountId,
    apiToken,
    dryRun = false,
    compatibilityDate,
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

  let client: CloudflareApiClient | null = null;
  if (!dryRun) {
    client = new CloudflareApiClient({ accountId, apiToken });
  }

  const { provisioned, results: resourceResults } = await provisionResources(
    manifest.spec.resources || {},
    { accountId, apiToken, groupName, env, dryRun },
    client,
  );
  result.resources = resourceResults;

  // Collect secrets for each service (secretRef resources referenced by bindings)
  const secretsByService = new Map<string, Map<string, string>>();

  // ── Step 2: Deploy each service ──────────────────────────────────────────

  for (const [workerName, worker] of Object.entries(manifest.spec.workers)) {
    // Worker service
    const wranglerConfig = generateWranglerConfig(worker, workerName, {
      groupName,
      env,
      namespace,
      resources: provisioned,
      compatibilityDate,
    });

    if (dryRun) {
      result.services.push(buildDryRunServiceResult(workerName, worker, wranglerConfig.name));

      // Report bindings that would be created
      if (worker.bindings?.d1) {
        for (const resourceName of worker.bindings.d1) {
          result.bindings.push({
            from: workerName,
            to: resourceName,
            type: 'd1',
            status: 'bound',
          });
        }
      }
      if (worker.bindings?.r2) {
        for (const resourceName of worker.bindings.r2) {
          result.bindings.push({
            from: workerName,
            to: resourceName,
            type: 'r2',
            status: 'bound',
          });
        }
      }
      if (worker.bindings?.kv) {
        for (const resourceName of worker.bindings.kv) {
          result.bindings.push({
            from: workerName,
            to: resourceName,
            type: 'kv',
            status: 'bound',
          });
        }
      }
      if (worker.bindings?.services) {
        for (const targetService of worker.bindings.services) {
          result.bindings.push({
            from: workerName,
            to: targetService,
            type: 'service',
            status: 'bound',
          });
        }
      }
      continue;
    }

    // Collect secrets for this service
    const serviceSecrets = new Map<string, string>();
    for (const [resourceName, resource] of provisioned) {
      if (resource.type === 'secretRef') {
        // Check if this service references this secret via its bindings
        // For secretRef, the resource ID holds the generated value
        serviceSecrets.set(resource.binding, resource.id);
      }
    }
    if (serviceSecrets.size > 0) {
      secretsByService.set(workerName, serviceSecrets);
    }

    const toml = serializeWranglerToml(wranglerConfig);

    try {
      const deployResult = await deployWorkerWithWrangler(toml, {
        accountId,
        apiToken,
        namespace,
        secrets: serviceSecrets,
        dryRun: false,
      });

      if (deployResult.success) {
        result.services.push({
          name: workerName,
          type: 'worker',
          status: 'deployed',
          scriptName: wranglerConfig.name,
        });

        // Record bindings as successful
        const bindingResults = collectBindingResults(workerName, worker, 'bound');
        result.bindings.push(...bindingResults);
      } else {
        result.services.push({
          name: workerName,
          type: 'worker',
          status: 'failed',
          scriptName: wranglerConfig.name,
          error: deployResult.error,
        });

        const bindingResults = collectBindingResults(workerName, worker, 'failed');
        result.bindings.push(...bindingResults);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.services.push({
        name: workerName,
        type: 'worker',
        status: 'failed',
        scriptName: wranglerConfig.name,
        error: message,
      });
    }
  }

  return result;
}

function collectBindingResults(
  serviceName: string,
  service: WorkerService,
  status: 'bound' | 'failed',
): BindingResult[] {
  const results: BindingResult[] = [];

  if (service.bindings?.d1) {
    for (const resourceName of service.bindings.d1) {
      results.push({ from: serviceName, to: resourceName, type: 'd1', status });
    }
  }
  if (service.bindings?.r2) {
    for (const resourceName of service.bindings.r2) {
      results.push({ from: serviceName, to: resourceName, type: 'r2', status });
    }
  }
  if (service.bindings?.kv) {
    for (const resourceName of service.bindings.kv) {
      results.push({ from: serviceName, to: resourceName, type: 'kv', status });
    }
  }
  if (service.bindings?.services) {
    for (const targetService of service.bindings.services) {
      results.push({ from: serviceName, to: targetService, type: 'service', status });
    }
  }

  return results;
}
