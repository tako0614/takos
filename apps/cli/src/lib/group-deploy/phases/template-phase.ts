/**
 * Group Deploy — template resolution phase.
 *
 * Handles Step 3: build template context and inject resolved env secrets
 * into deployed workers.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  GroupDeployOptions,
  GroupDeployResult,
} from '../deploy-models.js';
import { execCommand } from '../cloudflare-utils.js';
import {
  buildTemplateContext,
  resolveTemplateString,
} from '../template.js';

export async function resolveAndInjectTemplates(
  manifest: GroupDeployOptions['manifest'],
  options: GroupDeployOptions,
  result: GroupDeployResult,
  ctx: { accountId: string; apiToken: string; dryRun: boolean },
): Promise<void> {
  if (!manifest.spec.env?.inject) return;

  const { accountId, apiToken, dryRun } = ctx;

  const tmplCtx = buildTemplateContext(result, manifest, options);
  const resolvedEnv: Record<string, string> = {};
  for (const [key, template] of Object.entries(manifest.spec.env.inject)) {
    resolvedEnv[key] = resolveTemplateString(template, tmplCtx);
  }

  if (!dryRun && Object.keys(resolvedEnv).length > 0) {
    for (const svc of result.services) {
      if (svc.type !== 'worker' || svc.status !== 'deployed' || !svc.scriptName) continue;
      for (const [secretName, secretValue] of Object.entries(resolvedEnv)) {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-inject-'));
        try {
          const wranglerEnv: NodeJS.ProcessEnv = {
            CLOUDFLARE_ACCOUNT_ID: accountId,
            CLOUDFLARE_API_TOKEN: apiToken,
          };
          await execCommand(
            'npx',
            ['wrangler', 'secret', 'put', secretName, '--name', svc.scriptName],
            { cwd: tmpDir, env: wranglerEnv, stdin: secretValue },
          );
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* cleanup: best-effort temp dir removal */ });
        }
      }
    }
  }
}
