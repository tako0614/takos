/**
 * CLI command: `takos deploy-group`
 *
 * Backward-compatible alias for `takos apply --auto-approve`.
 *
 * Default (online): Send manifest to the API for apply (auto-approved).
 * --offline: Compute diff locally and apply via the local coordinator.
 * --wrangler-config: Direct wrangler deploy (unchanged, bypasses coordinator).
 *
 * For new workflows, prefer `takos apply`.
 *
 * Usage:
 *   takos deploy-group --env staging --namespace takos-staging-tenants
 *   takos deploy-group --manifest .takos/app.yml --env production --dry-run
 */
import { Command } from 'commander';
import path from 'node:path';
import chalk from 'chalk';
import { loadAppManifest, resolveAppManifestPath } from '../lib/app-manifest.js';
import { cliExit } from '../lib/command-exit.js';
import { printJson } from '../lib/cli-utils.js';
import { api } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { formatPlan } from '../lib/state/plan.js';
import type { DiffResult } from '../lib/state/diff.js';
import type { ApplyResult } from '../lib/apply/coordinator.js';

type DeployGroupCommandOptions = {
  manifest?: string;
  env: string;
  namespace?: string;
  group?: string;
  dryRun?: boolean;
  accountId?: string;
  apiToken?: string;
  compatibilityDate?: string;
  json?: boolean;
  service?: string[];
  worker?: string[];
  container?: string[];
  baseDomain?: string;
  wranglerConfig?: string;
  space?: string;
  offline?: boolean;
};

function resolveSpaceId(spaceOverride?: string): string {
  const spaceId = String(spaceOverride || getConfig().spaceId || '').trim();
  if (!spaceId) {
    console.log(chalk.red('Workspace ID is required. Pass --space or configure a default workspace.'));
    cliExit(1);
  }
  return spaceId;
}

function printApplyResult(result: ApplyResult, env: string, groupName: string, dryRun?: boolean): void {
  const titlePrefix = dryRun ? '[DRY RUN] ' : '';

  console.log('');
  console.log(chalk.bold(`${titlePrefix}Group Deploy: ${groupName}`));
  console.log(`  Environment: ${env}`);
  console.log('');

  if (result.applied.length > 0) {
    console.log(chalk.bold('Applied:'));
    for (const entry of result.applied) {
      const icon = entry.status === 'success' ? chalk.green('+') : chalk.red('!');
      const errorInfo = entry.error ? chalk.red(` -- ${entry.error}`) : '';
      console.log(`  ${icon} ${entry.name} [${entry.category}] ${entry.action}${errorInfo}`);
    }
    console.log('');
  }

  if (result.skipped.length > 0) {
    console.log(chalk.bold('Unchanged:'));
    for (const name of result.skipped) {
      console.log(`  ${chalk.dim('=')} ${name}`);
    }
    console.log('');
  }

  const succeeded = result.applied.filter(e => e.status === 'success').length;
  const failed = result.applied.filter(e => e.status === 'failed').length;

  console.log(chalk.bold('Summary:'));
  console.log(`  Applied:   ${succeeded} succeeded, ${failed} failed`);
  console.log(`  Unchanged: ${result.skipped.length}`);

  if (failed > 0) {
    console.log('');
    console.log(chalk.red('Some steps failed. Review errors above.'));
  } else if (!dryRun) {
    console.log('');
    console.log(chalk.green('Group deployment completed successfully.'));
  }
}

/** Offline fallback: use the local coordinator (original logic). */
async function handleDeployGroupOffline(
  manifest: Awaited<ReturnType<typeof loadAppManifest>>,
  manifestPath: string,
  options: DeployGroupCommandOptions,
): Promise<void> {
  const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
  const { readState, getStateDir } = await import('../lib/state/state-file.js');
  const { computeDiff } = await import('../lib/state/diff.js');
  const { applyDiff } = await import('../lib/apply/coordinator.js');
  type TakosState = import('../lib/state/state-types.js').TakosState;

  const accountId = resolveAccountId(options.accountId);
  const apiToken = resolveApiToken(options.apiToken);

  const group = options.group || manifest.metadata.name;
  const stateDir = getStateDir(process.cwd());
  let currentState: TakosState | null = null;
  try {
    currentState = await readState(stateDir, group, { offline: true });
  } catch {
    // No state yet
  }

  const diff = computeDiff(manifest, currentState);

  // dry-run: display diff and return
  if (options.dryRun) {
    if (options.json) {
      printJson(diff);
    } else {
      console.log(formatPlan(diff));
    }
    return;
  }

  const groupName = group;

  if (!options.json) {
    console.log(`${chalk.cyan('[DEPLOY]')} ${chalk.bold(manifest.metadata.name)} -> ${options.env} (offline)`);
    if (options.namespace) {
      console.log(`  Namespace: ${options.namespace}`);
    }
    console.log(`  Manifest:  ${manifestPath}`);
    console.log('');
  }

  const applyResult = await applyDiff(diff, manifest, {
    group,
    env: options.env,
    accountId,
    apiToken,
    groupName,
    namespace: options.namespace,
    manifestDir: path.dirname(manifestPath),
    baseDomain: options.baseDomain,
    autoApprove: true,
  });

  if (options.json) {
    printJson(applyResult);
    return;
  }

  printApplyResult(applyResult, options.env, groupName);

  const hasFailures = applyResult.applied.some(e => e.status === 'failed');
  if (hasFailures) {
    cliExit(1);
  }
}

export function registerDeployGroupCommand(program: Command): void {
  program
    .command('deploy-group')
    .description('Deploy an app group from .takos/app.yml (alias for apply --auto-approve)')
    .option('--manifest <path>', 'Path to app manifest', '.takos/app.yml')
    .requiredOption('--env <env>', 'Target environment (staging/production)')
    .option('--namespace <name>', 'Dispatch namespace (omit for account top-level)')
    .option('--group <name>', 'Group name override (defaults to manifest name)')
    .option('--dry-run', 'Show what would be deployed without deploying')
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--compatibility-date <date>', 'Worker compatibility date', '2025-01-01')
    .option('--service <name...>', 'Deploy only specific services (repeatable)')
    .option('--worker <name...>', 'Deploy only specific workers (repeatable)')
    .option('--container <name...>', 'Deploy only specific containers (repeatable)')
    .option('--base-domain <domain>', 'Base domain for template resolution')
    .option('--wrangler-config <path>', 'Deploy using a wrangler.toml directly')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (options: DeployGroupCommandOptions) => {
      // ── Validate mutual exclusivity ──────────────────────────────────
      if (options.wranglerConfig && options.manifest && options.manifest !== '.takos/app.yml') {
        console.log(chalk.red('--wrangler-config and --manifest are mutually exclusive.'));
        cliExit(1);
      }
      if (options.wranglerConfig && (options.service || options.worker || options.container)) {
        console.log(chalk.red('--wrangler-config and --service/--worker/--container are mutually exclusive.'));
        cliExit(1);
      }

      // ── Wrangler-config mode (unchanged -- bypasses coordinator) ─────
      if (options.wranglerConfig) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deployWranglerDirect } = await import('../lib/group-deploy/index.js');
        type WranglerDirectDeployResult = import('../lib/group-deploy/index.js').WranglerDirectDeployResult;

        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);

        const wranglerResult = await deployWranglerDirect({
          wranglerConfigPath: options.wranglerConfig,
          env: options.env,
          namespace: options.namespace,
          accountId,
          apiToken,
          dryRun: options.dryRun,
        });

        if (options.json) {
          printJson(wranglerResult);
          return;
        }

        // Print wrangler direct result
        console.log('');
        console.log(chalk.bold('Wrangler Direct Deploy'));
        console.log(`  Config: ${wranglerResult.configPath}`);
        console.log(`  Env:    ${wranglerResult.env}`);
        if (wranglerResult.namespace) {
          console.log(`  Namespace: ${wranglerResult.namespace}`);
        }
        const icon = wranglerResult.status === 'deployed' ? chalk.green('+')
          : wranglerResult.status === 'dry-run' ? chalk.yellow('~')
          : chalk.red('!');
        console.log(`  Status: ${icon} ${wranglerResult.status}`);
        if (wranglerResult.error) {
          console.log(`  Error:  ${chalk.red(wranglerResult.error)}`);
        }
        console.log('');

        if (wranglerResult.status === 'failed') {
          cliExit(1);
        }
        return;
      }

      // ── Manifest mode ────────────────────────────────────────────────

      // Load and validate manifest
      let manifestPath: string;
      try {
        manifestPath = options.manifest && options.manifest !== '.takos/app.yml'
          ? options.manifest
          : await resolveAppManifestPath(process.cwd());
      } catch {
        console.log(chalk.red('No .takos/app.yml found. Specify --manifest or run from a project root.'));
        cliExit(1);
      }

      let manifest;
      try {
        manifest = await loadAppManifest(manifestPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Invalid manifest: ${message}`));
        cliExit(1);
      }

      // Offline mode: delegate to local coordinator
      if (options.offline) {
        return handleDeployGroupOffline(manifest, manifestPath, options);
      }

      // ── Online mode: API-driven ──────────────────────────────────────
      const spaceId = resolveSpaceId(options.space);
      const group = options.group || manifest.metadata.name;

      // Build target list from --service/--worker/--container filters
      const targets: string[] = [];
      if (options.worker) {
        for (const w of options.worker) targets.push(`workers.${w}`);
      }
      if (options.container) {
        for (const c of options.container) targets.push(`containers.${c}`);
      }
      if (options.service) {
        for (const s of options.service) targets.push(`services.${s}`);
      }

      // dry-run: plan only
      if (options.dryRun) {
        const planRes = await api<DiffResult>(`/api/spaces/${spaceId}/groups/${group}/plan`, {
          method: 'POST',
          body: { manifest },
        });

        if (!planRes.ok) {
          console.log(chalk.red(`Error: ${planRes.error}`));
          cliExit(1);
        }

        if (options.json) {
          printJson(planRes.data);
        } else {
          console.log(formatPlan(planRes.data));
        }
        return;
      }

      if (!options.json) {
        console.log(`${chalk.cyan('[DEPLOY]')} ${chalk.bold(manifest.metadata.name)} -> ${options.env}`);
        if (options.namespace) {
          console.log(`  Namespace: ${options.namespace}`);
        }
        console.log(`  Manifest:  ${manifestPath}`);
        console.log('');
      }

      // Apply via API (auto-approve, since deploy-group never prompts)
      const applyRes = await api<ApplyResult>(`/api/spaces/${spaceId}/groups/${group}/apply`, {
        method: 'POST',
        body: {
          manifest,
          target: targets.length > 0 ? targets : undefined,
        },
        timeout: 120_000,
      });

      if (!applyRes.ok) {
        console.log(chalk.red(`Error: ${applyRes.error}`));
        cliExit(1);
      }

      const applyResult = applyRes.data;

      if (options.json) {
        printJson(applyResult);
        return;
      }

      printApplyResult(applyResult, options.env, group);

      const hasFailures = applyResult.applied.some(e => e.status === 'failed');
      if (hasFailures) {
        cliExit(1);
      }
    });
}
