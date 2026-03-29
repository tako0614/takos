/**
 * CLI command: `takos apply`
 *
 * Apply changes from app.yml to the target environment.
 * Computes a diff, displays the plan, optionally prompts for
 * confirmation, then delegates to the Layer 1 entity operations
 * via the apply coordinator.
 *
 * Usage:
 *   takos apply --env staging
 *   takos apply --env production --auto-approve
 *   takos apply --env staging --target resources.db --target workers.web
 */
import { Command } from 'commander';
import path from 'node:path';
import chalk from 'chalk';
import { loadAppManifest, resolveAppManifestPath } from '../lib/app-manifest.js';
import { cliExit } from '../lib/command-exit.js';
import { resolveAccountId, resolveApiToken, confirmPrompt } from '../lib/cli-utils.js';
import { readState, getStateDir } from '../lib/state/state-file.js';
import { computeDiff } from '../lib/state/diff.js';
import { formatPlan } from '../lib/state/plan.js';
import type { TakosState } from '../lib/state/state-types.js';
import type { DiffResult, DiffEntry } from '../lib/state/diff.js';
import { applyDiff } from '../lib/apply/coordinator.js';
import type { ApplyResult } from '../lib/apply/coordinator.js';

type ApplyCommandOptions = {
  manifest?: string;
  env: string;
  autoApprove?: boolean;
  target?: string[];
  accountId?: string;
  apiToken?: string;
  compatibilityDate?: string;
  namespace?: string;
  group?: string;
  baseDomain?: string;
  offline?: boolean;
};

/** Filter diff entries by --target values like "resources.db", "workers.web" */
function filterDiffByTargets(diff: DiffResult, targets: string[]): DiffResult {
  if (targets.length === 0) return diff;
  const filtered = diff.entries.filter((entry: DiffEntry) => {
    const categoryPlural = entry.category === 'resource' ? 'resources' : entry.category === 'worker' ? 'workers' : entry.category === 'container' ? 'containers' : entry.category === 'route' ? 'routes' : 'services';
    const key = `${categoryPlural}.${entry.name}`;
    return targets.some(target => key === target || key.endsWith(`.${target}`) || entry.name === target);
  });
  const summary = { create: 0, update: 0, delete: 0, unchanged: 0 };
  for (const entry of filtered) {
    summary[entry.action]++;
  }
  return {
    entries: filtered,
    hasChanges: summary.create > 0 || summary.update > 0 || summary.delete > 0,
    summary,
  };
}

/** Print apply result from the coordinator */
function printApplyResult(result: ApplyResult, env: string, groupName: string): void {
  console.log('');
  console.log(chalk.bold(`Apply: ${groupName}`));
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
  } else {
    console.log('');
    console.log(chalk.green('Apply completed successfully.'));
  }
}

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .description('Apply changes from app.yml to the target environment')
    .option('--manifest <path>', 'Path to app manifest', '.takos/app.yml')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--auto-approve', 'Skip interactive confirmation prompt')
    .option('--target <key...>', 'Apply only specific resources/services (e.g. resources.db, workers.web)')
    .option('--namespace <name>', 'Dispatch namespace')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--compatibility-date <date>', 'Worker compatibility date', '2025-01-01')
    .option('--base-domain <domain>', 'Base domain for template resolution')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (options: ApplyCommandOptions) => {
      const accountId = resolveAccountId(options.accountId);
      const apiToken = resolveApiToken(options.apiToken);

      // Step 1: Load manifest
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

      // Step 2: Read current state
      const stateDir = getStateDir(process.cwd());
      const group = options.group || 'default';
      const accessOpts = options.offline ? { offline: true as const } : {};
      let currentState: TakosState | null = null;
      try {
        currentState = await readState(stateDir, group, accessOpts);
      } catch {
        // No state yet
      }

      // Step 3: Compute diff
      const fullDiff = computeDiff(manifest, currentState);
      const targets = options.target || [];
      const diff = filterDiffByTargets(fullDiff, targets);

      // Step 4: Display plan
      console.log('');
      console.log(chalk.bold(`Apply: ${manifest.metadata.name}`));
      console.log(`  Environment: ${options.env}`);
      console.log(`  Manifest:    ${manifestPath}`);
      if (targets.length > 0) {
        console.log(`  Targets:     ${targets.join(', ')}`);
      }
      console.log('');

      const planOutput = formatPlan(diff);
      console.log(planOutput);

      const totalChanges = diff.entries.filter(d => d.action !== 'unchanged').length;
      if (totalChanges === 0) {
        console.log(chalk.green('No changes. Infrastructure is up-to-date.'));
        return;
      }

      console.log(chalk.yellow(`${totalChanges} change(s) to apply.`));
      console.log('');

      // Step 5: Confirmation
      if (!options.autoApprove) {
        const hasDeletes = diff.entries.some(d => d.action === 'delete');
        const promptMessage = hasDeletes
          ? chalk.red.bold('This will DELETE resources. Continue?')
          : 'Do you want to apply these changes?';

        const confirmed = await confirmPrompt(promptMessage);
        if (!confirmed) {
          console.log(chalk.dim('Apply cancelled.'));
          return;
        }
      }

      // Step 6: Execute via coordinator (Layer 1 entity operations)
      console.log('');
      console.log(chalk.cyan('Applying changes...'));
      console.log('');

      const groupName = options.group || manifest.metadata.name;

      const applyResult = await applyDiff(diff, manifest, {
        group,
        env: options.env,
        accountId,
        apiToken,
        groupName,
        namespace: options.namespace,
        manifestDir: path.dirname(manifestPath),
        baseDomain: options.baseDomain,
        autoApprove: options.autoApprove,
      });

      // Step 7: Display results
      printApplyResult(applyResult, options.env, groupName);

      const hasFailures = applyResult.applied.some(e => e.status === 'failed');
      if (hasFailures) {
        cliExit(1);
      }
    });
}
