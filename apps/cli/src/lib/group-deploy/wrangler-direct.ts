/**
 * Group Deploy — wrangler direct deploy.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { WranglerDirectDeployOptions, WranglerDirectDeployResult } from './deploy-models.ts';
import { execCommand } from './cloudflare-utils.ts';

// ── Wrangler Direct Deploy ───────────────────────────────────────────────────

export function injectDispatchNamespace(tomlContent: string, env: string, namespace: string): string {
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
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* cleanup: best-effort temp dir removal */ });
  }
}
