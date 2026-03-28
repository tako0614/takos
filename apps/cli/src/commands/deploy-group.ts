/**
 * CLI command: `takos deploy-group`
 *
 * Backward-compatible alias for `takos apply --auto-approve`.
 *
 * Loads the manifest, computes a diff, and delegates to the apply
 * coordinator with auto-approve enabled.  Wrangler-config mode and
 * dry-run are still supported for backward compatibility.
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
import { readState, getStateDir } from '../lib/state/state-file.js';
import { computeDiff } from '../lib/state/diff.js';
import type { TakosState } from '../lib/state/state-types.js';
import { applyDiff } from '../lib/apply/coordinator.js';
import type { ApplyResult } from '../lib/apply/coordinator.js';
import { deployWranglerDirect } from '../lib/group-deploy/index.js';
import type { WranglerDirectDeployResult } from '../lib/group-deploy/index.js';

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
};

function resolveAccountId(override?: string): string {
  const accountId = override || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '';
  if (!accountId.trim()) {
    console.log(chalk.red('Cloudflare account ID is required.'));
    console.log(chalk.dim('Pass --account-id, or set CLOUDFLARE_ACCOUNT_ID.'));
    cliExit(1);
  }
  return accountId.trim();
}

function resolveApiToken(override?: string): string {
  const apiToken = override || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '';
  if (!apiToken.trim()) {
    console.log(chalk.red('Cloudflare API token is required.'));
    console.log(chalk.dim('Pass --api-token, or set CLOUDFLARE_API_TOKEN.'));
    cliExit(1);
  }
  return apiToken.trim();
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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

function printWranglerDirectResult(result: WranglerDirectDeployResult): void {
  console.log('');
  console.log(chalk.bold('Wrangler Direct Deploy'));
  console.log(`  Config: ${result.configPath}`);
  console.log(`  Env:    ${result.env}`);
  if (result.namespace) {
    console.log(`  Namespace: ${result.namespace}`);
  }

  const icon = result.status === 'deployed' ? chalk.green('+')
    : result.status === 'dry-run' ? chalk.yellow('~')
    : chalk.red('!');
  console.log(`  Status: ${icon} ${result.status}`);

  if (result.error) {
    console.log(`  Error:  ${chalk.red(result.error)}`);
  }
  console.log('');
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
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--compatibility-date <date>', 'Worker compatibility date', '2025-01-01')
    .option('--service <name...>', 'Deploy only specific services (repeatable)')
    .option('--worker <name...>', 'Deploy only specific workers (repeatable)')
    .option('--container <name...>', 'Deploy only specific containers (repeatable)')
    .option('--base-domain <domain>', 'Base domain for template resolution')
    .option('--wrangler-config <path>', 'Deploy using a wrangler.toml directly')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options: DeployGroupCommandOptions) => {
      const accountId = resolveAccountId(options.accountId);
      const apiToken = resolveApiToken(options.apiToken);

      // ── Validate mutual exclusivity ──────────────────────────────────
      if (options.wranglerConfig && options.manifest && options.manifest !== '.takos/app.yml') {
        console.log(chalk.red('--wrangler-config and --manifest are mutually exclusive.'));
        cliExit(1);
      }
      if (options.wranglerConfig && (options.service || options.worker || options.container)) {
        console.log(chalk.red('--wrangler-config and --service/--worker/--container are mutually exclusive.'));
        cliExit(1);
      }

      // ── Wrangler-config mode (unchanged — bypasses coordinator) ─────
      if (options.wranglerConfig) {
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

        printWranglerDirectResult(wranglerResult);

        if (wranglerResult.status === 'failed') {
          cliExit(1);
        }
        return;
      }

      // ── Manifest mode — delegate to coordinator ─────────────────────

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

      // Read current state and compute diff
      const stateDir = getStateDir(process.cwd());
      let currentState: TakosState | null = null;
      try {
        currentState = await readState(stateDir);
      } catch {
        // No state file yet
      }

      const diff = computeDiff(manifest, currentState);

      // dry-run: display diff and return
      if (options.dryRun) {
        if (options.json) {
          printJson(diff);
        } else {
          const { formatPlan } = await import('../lib/state/plan.js');
          console.log(formatPlan(diff));
        }
        return;
      }

      const groupName = options.group || manifest.metadata.name;

      if (!options.json) {
        console.log(`${chalk.cyan('[DEPLOY]')} ${chalk.bold(manifest.metadata.name)} -> ${options.env}`);
        if (options.namespace) {
          console.log(`  Namespace: ${options.namespace}`);
        }
        console.log(`  Manifest:  ${manifestPath}`);
        console.log('');
      }

      // Delegate to coordinator (auto-approve, since deploy-group never prompts)
      const applyResult = await applyDiff(diff, manifest, {
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

      // Exit with error code if any entry failed
      const hasFailures = applyResult.applied.some(e => e.status === 'failed');
      if (hasFailures) {
        cliExit(1);
      }
    });
}
