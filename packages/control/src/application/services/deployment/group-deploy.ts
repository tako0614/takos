/**
 * Group Deploy Orchestrator.
 *
 * Deploys an entire app.yml manifest as a group.
 *
 * This bypasses the Takos store install flow and deploys directly to
 * Cloudflare infrastructure using the Cloudflare API and wrangler CLI.
 *
 * The public manifest contract no longer supports `storage`, so this path
 * only deploys worker compute and treats any legacy storage entries as a
 * hard error.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppCompute } from "../source/app-manifest-types.ts";
import type {
  GroupDeployOptions,
  GroupDeployResult,
  ServiceDeployResult,
} from "./group-deploy-types.ts";
import {
  generateWranglerConfig,
  serializeWranglerToml,
} from "./wrangler-config-gen.ts";

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
 * 1. Deploy each worker compute via wrangler
 * 2. Report results
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

  if (manifest.storage && Object.keys(manifest.storage).length > 0) {
    throw new Error(
      "group deploy no longer supports manifest.storage; publish provider-backed resources and consume their outputs instead",
    );
  }

  // ── Step 1: Deploy each worker ────────────────────────────────────────────

  const workerEntries = Object.entries(manifest.compute ?? {}).filter(
    ([, compute]) => compute.kind === "worker",
  );
  const emptyResources = new Map<string, never>();

  for (const [workerName, worker] of workerEntries) {
    const wranglerConfig = generateWranglerConfig(worker, workerName, {
      groupName,
      env,
      namespace,
      resources: emptyResources,
      compatibilityDate,
    });

    if (dryRun) {
      result.services.push(
        buildDryRunServiceResult(workerName, worker, wranglerConfig.name),
      );
      continue;
    }

    const toml = serializeWranglerToml(wranglerConfig);

    try {
      const deployResult = await deployWorkerWithWrangler(toml, {
        accountId,
        apiToken,
        namespace,
        dryRun: false,
      });

      if (deployResult.success) {
        result.services.push({
          name: workerName,
          type: "worker",
          status: "deployed",
          scriptName: wranglerConfig.name,
        });
      } else {
        result.services.push({
          name: workerName,
          type: "worker",
          status: "failed",
          scriptName: wranglerConfig.name,
          error: deployResult.error,
        });
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
