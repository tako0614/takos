/**
 * CLI command: `takos apply`
 *
 * Apply changes from app.yml to the target environment.
 *
 * Default (online): Send manifest to the API for plan + apply.
 * --offline: Compute diff locally and apply via the local coordinator.
 *
 * Usage:
 *   takos apply --env staging
 *   takos apply --env production --auto-approve
 *   takos apply --env staging --target resources.db --target workers.web
 *   takos apply --offline --env staging
 */
import { Command } from 'commander';
import path from 'node:path';
import chalk from 'chalk';
import { loadAppManifest, resolveAppManifestPath } from '../lib/app-manifest.js';
import { cliExit } from '../lib/command-exit.js';
import { confirmPrompt } from '../lib/cli-utils.js';
import { api } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { formatPlan } from '../lib/state/plan.js';
import type { DiffResult } from '../lib/state/diff.js';
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

/** Print apply result (shared between online and offline). */
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

/** Offline fallback: use the local coordinator (original logic). */
async function handleApplyOffline(
  manifest: Awaited<ReturnType<typeof loadAppManifest>>,
  manifestPath: string,
  options: ApplyCommandOptions,
): Promise<void> {
  const { readState, getStateDir } = await import('../lib/state/state-file.js');
  const { computeDiff } = await import('../lib/state/diff.js');
  const { applyDiff } = await import('../lib/apply/coordinator.js');
  const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
  type TakosState = import('../lib/state/state-types.js').TakosState;
  type DiffEntry = import('../lib/state/diff.js').DiffEntry;
  type OfflineDiffResult = import('../lib/state/diff.js').DiffResult;

  const accountId = resolveAccountId(options.accountId);
  const apiToken = resolveApiToken(options.apiToken);

  const stateDir = getStateDir(process.cwd());
  const group = options.group || 'default';
  let currentState: TakosState | null = null;
  try {
    currentState = await readState(stateDir, group, { offline: true });
  } catch {
    // No state yet
  }

  const fullDiff = computeDiff(manifest, currentState);
  const targets = options.target || [];
  const diff = filterDiffByTargets(fullDiff, targets);

  console.log('');
  console.log(chalk.bold(`Apply: ${manifest.metadata.name}`));
  console.log(`  Environment: ${options.env}`);
  console.log(`  Manifest:    ${manifestPath}`);
  console.log(`  Mode:        offline`);
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

  printApplyResult(applyResult, options.env, groupName);

  const hasFailures = applyResult.applied.some(e => e.status === 'failed');
  if (hasFailures) {
    cliExit(1);
  }

  /** Filter diff entries by --target values like "resources.db", "workers.web" */
  function filterDiffByTargets(diffResult: OfflineDiffResult, filterTargets: string[]): OfflineDiffResult {
    if (filterTargets.length === 0) return diffResult;
    const filtered = diffResult.entries.filter((entry: DiffEntry) => {
      const categoryPlural = entry.category === 'resource' ? 'resources' : entry.category === 'worker' ? 'workers' : entry.category === 'container' ? 'containers' : entry.category === 'route' ? 'routes' : 'services';
      const key = `${categoryPlural}.${entry.name}`;
      return filterTargets.some(t => key === t || key.endsWith(`.${t}`) || entry.name === t);
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
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--compatibility-date <date>', 'Worker compatibility date', '2025-01-01')
    .option('--base-domain <domain>', 'Base domain for template resolution')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (options: ApplyCommandOptions) => {
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

      // Offline mode: delegate to local coordinator
      if (options.offline) {
        return handleApplyOffline(manifest, manifestPath, options);
      }

      // Online mode: API-driven plan + apply
      const spaceId = resolveSpaceId(options.space);
      const group = options.group || 'default';
      const targets = options.target || [];

      // Step 2: Plan via API
      const planRes = await api<DiffResult>(`/api/spaces/${spaceId}/groups/${group}/plan`, {
        method: 'POST',
        body: { manifest },
      });

      if (!planRes.ok) {
        console.log(chalk.red(`Error: ${planRes.error}`));
        cliExit(1);
      }

      const diff = planRes.data;

      // Step 3: Display plan
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

      if (!diff.hasChanges) {
        console.log(chalk.green('No changes. Infrastructure is up-to-date.'));
        return;
      }

      const totalChanges = diff.entries.filter(d => d.action !== 'unchanged').length;
      console.log(chalk.yellow(`${totalChanges} change(s) to apply.`));
      console.log('');

      // Step 4: Confirmation
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

      // Step 5: Apply via API
      console.log('');
      console.log(chalk.cyan('Applying changes...'));
      console.log('');

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

      const result = applyRes.data;
      const groupName = options.group || manifest.metadata.name;
      printApplyResult(result, options.env, groupName);

      const hasFailures = result.applied.some(e => e.status === 'failed');
      if (hasFailures) {
        cliExit(1);
      }
    });
}
