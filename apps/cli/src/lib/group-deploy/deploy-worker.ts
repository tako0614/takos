/**
 * Group Deploy — worker deploy via wrangler.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execCommand } from './cloudflare-utils.js';

// ── Worker Deploy via Wrangler ───────────────────────────────────────────────

export async function deployWorkerWithWrangler(
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
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* cleanup: best-effort temp dir removal */ });
  }
}
