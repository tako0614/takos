/**
 * CLI command: `takos plan`
 *
 * Compute and display the diff between the desired state (app.yml)
 * and the current state.
 *
 * Default (online): POST manifest to the API and display the returned diff.
 * --offline: Compute diff locally using the file-based state backend.
 *
 * Usage:
 *   takos plan
 *   takos plan --manifest .takos/app.yml --env staging
 *   takos plan --offline
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { loadAppManifest, resolveAppManifestPath } from '../lib/app-manifest.js';
import { cliExit } from '../lib/command-exit.js';
import { api } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { formatPlan } from '../lib/state/plan.js';
import type { DiffResult } from '../lib/state/diff.js';

type PlanCommandOptions = {
  manifest?: string;
  env: string;
  group: string;
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

/** Offline fallback: compute diff locally (original logic). */
async function handlePlanOffline(manifest: Awaited<ReturnType<typeof loadAppManifest>>, manifestPath: string, options: PlanCommandOptions): Promise<void> {
  const { readState, getStateDir } = await import('../lib/state/state-file.js');
  const { computeDiff } = await import('../lib/state/diff.js');
  type TakosState = import('../lib/state/state-types.js').TakosState;

  const group = options.group;
  let currentState: TakosState | null = null;
  try {
    currentState = await readState(getStateDir(process.cwd()), group, { offline: true });
  } catch {
    // No state yet -- treat as fresh deployment
  }

  const diff = computeDiff(manifest, currentState);

  console.log('');
  console.log(chalk.bold(`Plan: ${manifest.metadata.name}`));
  console.log(`  Environment: ${options.env}`);
  console.log(`  Manifest:    ${manifestPath}`);
  console.log(`  Mode:        offline`);
  console.log('');

  const planOutput = formatPlan(diff);
  console.log(planOutput);

  const totalChanges = diff.entries.filter(d => d.action !== 'unchanged').length;
  if (totalChanges === 0) {
    console.log(chalk.green('No changes. Infrastructure is up-to-date.'));
  } else {
    console.log(chalk.yellow(`Plan: ${totalChanges} change(s) detected.`));
    console.log(chalk.dim('Run `takos apply` to apply these changes.'));
  }
}

export function registerPlanCommand(program: Command): void {
  program
    .command('plan')
    .description('Show execution plan: diff between app.yml and current state')
    .option('--manifest <path>', 'Path to app manifest', '.takos/app.yml')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (options: PlanCommandOptions) => {
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

      // Offline mode: delegate to local diff computation
      if (options.offline) {
        return handlePlanOffline(manifest, manifestPath, options);
      }

      // Online mode: POST manifest to API
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      const res = await api<DiffResult>(`/api/spaces/${spaceId}/groups/${group}/plan`, {
        method: 'POST',
        body: { manifest },
      });

      if (!res.ok) {
        console.log(chalk.red(`Error: ${res.error}`));
        cliExit(1);
      }

      const diff = res.data;

      console.log('');
      console.log(chalk.bold(`Plan: ${manifest.metadata.name}`));
      console.log(`  Environment: ${options.env}`);
      console.log(`  Manifest:    ${manifestPath}`);
      console.log('');

      const planOutput = formatPlan(diff);
      console.log(planOutput);

      const totalChanges = diff.entries.filter(d => d.action !== 'unchanged').length;
      if (totalChanges === 0) {
        console.log(chalk.green('No changes. Infrastructure is up-to-date.'));
      } else {
        console.log(chalk.yellow(`Plan: ${totalChanges} change(s) detected.`));
        console.log(chalk.dim('Run `takos apply` to apply these changes.'));
      }
    });
}
