/**
 * Group Deploy Orchestrator.
 *
 * Deploys an entire app.yml manifest as a group — provisions storage,
 * deploys worker compute via wrangler, and wires up every storage binding.
 *
 * This bypasses the Takos store install flow and deploys directly to
 * Cloudflare infrastructure using the Cloudflare API and wrangler CLI.
 *
 * Phase 2: rewritten against the flat-schema `AppManifest`. Worker
 * selection is now `compute.filter(kind=worker)` and bindings are
 * materialized from the top-level `storage` map.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppCompute } from "../source/app-manifest-types.ts";
import type {
  BindingResult,
  GroupDeployOptions,
  GroupDeployResult,
  ServiceDeployResult,
} from "./group-deploy-types.ts";
import { provisionResources } from "./resource-provisioner.ts";
import {
  generateWranglerConfig,
  serializeWranglerToml,
} from "./wrangler-config-gen.ts";
import { CloudflareApiClient } from "../cloudflare/api-client.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function execCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd: options?.cwd,
      env: { ...Deno.env.toObject(), ...options?.env },
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        exitCode: error
          ? ((error as NodeJS.ErrnoException & { code?: number })
            .code as unknown as number) || 1
          : 0,
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
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "takos-group-deploy-"),
  );
  const tomlPath = path.join(tmpDir, "wrangler.toml");
  const entryPath = path.join(tmpDir, "index.js");

  try {
    await fs.writeFile(tomlPath, tomlContent, "utf8");
    await fs.writeFile(
      entryPath,
      'export default { fetch() { return new Response("ok"); } };',
      "utf8",
    );

    if (options.dryRun) {
      return { success: true };
    }

    const wranglerEnv: NodeJS.ProcessEnv = {
      CLOUDFLARE_ACCOUNT_ID: options.accountId,
      CLOUDFLARE_API_TOKEN: options.apiToken,
    };

    const deployResult = await execCommand(
      "npx",
      [
        "wrangler",
        "deploy",
        "--config",
        tomlPath,
        ...(options.namespace
          ? ["--dispatch-namespace", options.namespace]
          : []),
      ],
      { cwd: tmpDir, env: wranglerEnv },
    );

    if (deployResult.exitCode !== 0) {
      return {
        success: false,
        error: `wrangler deploy failed: ${
          deployResult.stderr || deployResult.stdout
        }`,
      };
    }

    if (options.secrets && options.secrets.size > 0) {
      for (const [secretName, secretValue] of options.secrets) {
        const secretResult = await execCommand(
          "npx",
          ["wrangler", "secret", "put", secretName, "--config", tomlPath],
          {
            cwd: tmpDir,
            env: {
              ...wranglerEnv,
              WRANGLER_SECRET_VALUE: secretValue,
            },
          },
        );
        if (secretResult.exitCode !== 0) {
          return {
            success: false,
            error: `Failed to set secret ${secretName}: ${
              secretResult.stderr || secretResult.stdout
            }`,
          };
        }
      }
    }

    return { success: true };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(
      () => {/* cleanup: best-effort temp dir removal */},
    );
  }
}

// ── Dry-run plan formatter ───────────────────────────────────────────────────

function buildDryRunServiceResult(
  serviceName: string,
  _worker: AppCompute,
  scriptName: string,
): ServiceDeployResult {
  return {
    name: serviceName,
    type: "worker",
    status: "deployed",
    scriptName,
  };
}

// ── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Deploy an app manifest as a group.
 *
 * Steps:
 * 1. Provision storage (sql / object-store / key-value / secret)
 * 2. Deploy each worker compute via wrangler
 * 3. Wire up every storage binding as part of the wrangler config
 * 4. Report results
 *
 * Errors in individual workers do not abort the entire deployment —
 * every worker is attempted and the result reports each status.
 */
export async function deployGroup(
  options: GroupDeployOptions,
): Promise<GroupDeployResult> {
  const {
    manifest,
    env,
    namespace,
    accountId,
    apiToken,
    dryRun = false,
    compatibilityDate,
  } = options;

  const groupName = options.groupName || manifest.name;

  const result: GroupDeployResult = {
    groupName,
    env,
    namespace,
    dryRun,
    services: [],
    resources: [],
    bindings: [],
  };

  // ── Step 1: Provision storage ─────────────────────────────────────────────

  let client: CloudflareApiClient | null = null;
  if (!dryRun) {
    client = new CloudflareApiClient({ accountId, apiToken });
  }

  const { provisioned, results: resourceResults } = await provisionResources(
    manifest.storage ?? {},
    { accountId, apiToken, groupName, env, dryRun },
    client,
  );
  result.resources = resourceResults;

  // Collect secrets so every deployed worker gets them applied.
  const sharedSecrets = new Map<string, string>();
  for (const provisionedResource of provisioned.values()) {
    if (provisionedResource.type === "secret" && provisionedResource.id) {
      sharedSecrets.set(
        provisionedResource.binding,
        provisionedResource.id,
      );
    }
  }

  // ── Step 2: Deploy each worker ────────────────────────────────────────────

  const workerEntries = Object.entries(manifest.compute ?? {}).filter(
    ([, compute]) => compute.kind === "worker",
  );

  for (const [workerName, worker] of workerEntries) {
    const wranglerConfig = generateWranglerConfig(worker, workerName, {
      groupName,
      env,
      namespace,
      resources: provisioned,
      compatibilityDate,
    });

    if (dryRun) {
      result.services.push(
        buildDryRunServiceResult(workerName, worker, wranglerConfig.name),
      );
      for (const [resourceName, resource] of provisioned) {
        result.bindings.push({
          from: workerName,
          to: resourceName,
          type: resource.type,
          status: "bound",
        });
      }
      continue;
    }

    const toml = serializeWranglerToml(wranglerConfig);

    try {
      const deployResult = await deployWorkerWithWrangler(toml, {
        accountId,
        apiToken,
        namespace,
        secrets: sharedSecrets,
        dryRun: false,
      });

      if (deployResult.success) {
        result.services.push({
          name: workerName,
          type: "worker",
          status: "deployed",
          scriptName: wranglerConfig.name,
        });
        result.bindings.push(
          ...collectBindingResults(workerName, provisioned, "bound"),
        );
      } else {
        result.services.push({
          name: workerName,
          type: "worker",
          status: "failed",
          scriptName: wranglerConfig.name,
          error: deployResult.error,
        });
        result.bindings.push(
          ...collectBindingResults(workerName, provisioned, "failed"),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.services.push({
        name: workerName,
        type: "worker",
        status: "failed",
        scriptName: wranglerConfig.name,
        error: message,
      });
    }
  }

  return result;
}

function collectBindingResults(
  workerName: string,
  provisioned: Map<string, import("./group-deploy-types.ts").ProvisionedResource>,
  status: "bound" | "failed",
): BindingResult[] {
  const results: BindingResult[] = [];
  for (const [resourceName, resource] of provisioned) {
    results.push({
      from: workerName,
      to: resourceName,
      type: resource.type,
      status,
    });
  }
  return results;
}
