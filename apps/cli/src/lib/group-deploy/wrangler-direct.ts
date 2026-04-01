/**
 * Group Deploy — wrangler direct deploy.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  WranglerDirectDeployOptions,
  WranglerDirectDeployResult,
} from "./deploy-models.ts";
import { execCommand } from "./cloudflare-utils.ts";

// ── Wrangler Direct Deploy ───────────────────────────────────────────────────

export async function deployWranglerDirect(
  options: WranglerDirectDeployOptions,
): Promise<WranglerDirectDeployResult> {
  const { wranglerConfigPath, env, namespace, accountId, apiToken, dryRun } =
    options;

  let tomlContent: string;
  try {
    tomlContent = await fs.readFile(wranglerConfigPath, "utf8");
  } catch (error) {
    return {
      configPath: wranglerConfigPath,
      env,
      namespace,
      status: "failed",
      error: `Failed to read config: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (dryRun) {
    console.log(tomlContent);
    return {
      configPath: wranglerConfigPath,
      env,
      namespace,
      status: "dry-run",
    };
  }

  // Write to temp file and deploy
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "takos-wrangler-direct-"),
  );
  const tmpConfigPath = path.join(tmpDir, "wrangler.toml");

  try {
    await fs.writeFile(tmpConfigPath, tomlContent, "utf8");

    const wranglerEnv: NodeJS.ProcessEnv = {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: apiToken,
    };

    const deployResult = await execCommand(
      "npx",
      [
        "wrangler",
        "deploy",
        "--config",
        tmpConfigPath,
        "--env",
        env,
        ...(namespace ? ["--dispatch-namespace", namespace] : []),
      ],
      { cwd: tmpDir, env: wranglerEnv },
    );

    if (deployResult.exitCode !== 0) {
      return {
        configPath: wranglerConfigPath,
        env,
        namespace,
        status: "failed",
        error: `wrangler deploy failed: ${
          deployResult.stderr || deployResult.stdout
        }`,
      };
    }

    return {
      configPath: wranglerConfigPath,
      env,
      namespace,
      status: "deployed",
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(
      () => {/* cleanup: best-effort temp dir removal */},
    );
  }
}
